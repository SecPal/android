#!/usr/bin/env perl
# SPDX-FileCopyrightText: 2026 SecPal Contributors
# SPDX-License-Identifier: MIT

use strict;
use warnings;

sub tokens {
    my ($source, $start, $end, $items) = @_;
    my $i = $start;
    my $previous = '';
    while ($i < $end) {
        if (substr($source, $i, 2) eq '//') {
            $i = index($source, "\n", $i);
            $i = $end if $i < 0;
            next;
        }
        if (substr($source, $i, 2) eq '/*') {
            $i = index($source, '*/', $i + 2);
            $i = $end if $i < 0;
            $i += 2 if $i < $end;
            next;
        }
        my $character = substr($source, $i, 1);
        if ($character eq q{"} || $character eq q{'}) {
            my ($quote, $begin) = ($character, $i++);
            my $value = '';
            while ($i < $end) {
                my $next = substr($source, $i++, 1);
                if ($next eq '\\') {
                    $value .= $next . substr($source, $i++, 1) if $i < $end;
                } elsif ($next eq $quote) {
                    last;
                } else {
                    $value .= $next;
                }
            }
            push @$items, { type => 'string', value => $value, start => $begin, end => $i };
            $previous = 'value';
            next;
        }
        if ($character eq '`') {
            my $begin = $i++;
            while ($i < $end) {
                my $next = substr($source, $i++, 1);
                if ($next eq '\\') {
                    ++$i;
                } elsif ($next eq '`') {
                    last;
                } elsif ($next eq '$' && substr($source, $i, 1) eq '{') {
                    my ($depth, $expression_start) = (1, ++$i);
                    while ($i < $end && $depth) {
                        my $part = substr($source, $i++, 1);
                        ++$depth if $part eq '{';
                        --$depth if $part eq '}';
                    }
                    tokens($source, $expression_start, $i - 1, $items);
                }
            }
            push @$items, { type => 'template', start => $begin, end => $i };
            $previous = 'value';
            next;
        }
        if ($character eq '/' && $previous ne 'value' && $previous ne ')' && $previous ne ']') {
            ++$i;
            my $in_class = 0;
            while ($i < $end) {
                my $next = substr($source, $i++, 1);
                if ($next eq '\\') { ++$i; next; }
                $in_class = 1 if $next eq '[';
                $in_class = 0 if $next eq ']';
                last if $next eq '/' && !$in_class;
            }
            ++$i while $i < $end && substr($source, $i, 1) =~ /[A-Za-z]/;
            $previous = 'value';
            next;
        }
        if ($character =~ /[A-Za-z_\$]/) {
            my $begin = $i++;
            ++$i while $i < $end && substr($source, $i, 1) =~ /[A-Za-z0-9_\$]/;
            my $value = substr($source, $begin, $i - $begin);
            push @$items, { type => 'identifier', value => $value, start => $begin, end => $i };
            $previous = $value;
            next;
        }
        if ($character !~ /\s/) {
            push @$items, { type => $character, value => $character, start => $i, end => ++$i };
            $previous = $character;
        } else {
            ++$i;
        }
    }
}

sub storage_argument {
    my ($items, $index) = @_;
    my $i = $index;
    return if $index && ($items->[$index - 1]{value} // '') eq '.';
    $i += 2 if ($items->[$i]{value} // '') =~ /^(?:window|globalThis)$/ && ($items->[$i + 1]{value} // '') eq '.';
    return unless ($items->[$i]{value} // '') =~ /^(?:localStorage|sessionStorage)$/;
    return unless ($items->[$i + 1]{value} // '') eq '.';
    return unless ($items->[$i + 2]{value} // '') =~ /^(?:getItem|setItem|removeItem)$/;
    return unless ($items->[$i + 3]{value} // '') eq '(';
    return $i + 4;
}

sub parser_exemptions {
    my ($source) = @_;
    my @items;
    tokens($source, 0, length($source), \@items);
    @items = sort { $a->{start} <=> $b->{start} } @items;
    my @scopes = ({ start => 0, end => length($source), parent => undef });
    my @scope_stack = (0);
    my @scope_depth = (0);
    for my $item (@items) {
        if (($item->{value} // '') eq '{') {
            push @scopes, { start => $item->{start}, end => length($source), parent => $scope_stack[-1] };
            push @scope_depth, scalar @scope_stack;
            push @scope_stack, $#scopes;
        } elsif (($item->{value} // '') eq '}' && @scope_stack > 1) {
            $scopes[$scope_stack[-1]]{end} = $item->{end};
            pop @scope_stack;
        }
        $item->{scope} = $scope_stack[-1];
    }
    my @declarations;
    for my $i (0 .. $#items - 4) {
        next unless ($items[$i]{value} // '') =~ /^(?:const|let|var)$/;
        my $name = $items[$i + 1];
        next unless $name->{type} eq 'identifier';
        my $equals = $i + 2;
        ++$equals while $equals <= $#items && ($items[$equals]{value} // '') ne '=' && ($items[$equals]{value} // '') ne ';';
        next unless $equals <= $#items && ($items[$equals]{value} // '') eq '=';
        my $value = $items[$equals + 1] // next;
        my $terminator = $items[$equals + 2] // next;
        next unless $value->{type} eq 'string' && $terminator->{value} eq ';';
        next unless $value->{value} =~ /^secpal\.[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/;
        push @declarations, { name => $name->{value}, scope => $name->{scope}, depth => $scope_depth[$name->{scope}], value => $value, name_start => $name->{start}, uses => [] };
    }
    for my $i (0 .. $#items) {
        my $argument = storage_argument(\@items, $i);
        next unless defined $argument && ($items[$argument]{type} // '') =~ /^(?:identifier|string)$/;
        $items[$argument]{storage_use} = 1;
    }
    for my $item (@items) {
        next unless $item->{type} eq 'identifier';
        my $resolved;
        for my $declaration (@declarations) {
            next unless $item->{value} eq $declaration->{name} && $item->{start} > $declaration->{name_start};
            my $scope = $item->{scope};
            $scope = $scopes[$scope]{parent} while defined $scope && $scope != $declaration->{scope};
            next unless defined $scope;
            $resolved = $declaration if !defined $resolved || $declaration->{depth} > $resolved->{depth};
        }
        push @{ $resolved->{uses} }, $item if defined $resolved;
    }
    my @exempt = map { $_->{value} } grep {
        @{ $_->{uses} } && !grep { !$_->{storage_use} } @{ $_->{uses} }
    } @declarations;
    for my $i (0 .. $#items) {
        my $argument = storage_argument(\@items, $i);
        next unless defined $argument;
        my $value = $items[$argument];
        my $next = $items[$argument + 1] // next;
        push @exempt, $value if $value->{type} eq 'string'
            && $value->{value} =~ /^secpal\.[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/
            && $next->{value} =~ /^(?:,|\))$/;
    }
    return @exempt;
}

for my $file (@ARGV) {
    open my $handle, '<', $file or die "Cannot read $file: $!\n";
    local $/;
    my $source = <$handle>;
    if ($file =~ /\.(?:[cm]?[jt]sx?)$/) {
        for my $value (sort { $b->{start} <=> $a->{start} } parser_exemptions($source)) {
            substr($source, $value->{start}, $value->{end} - $value->{start}) = '__secpal_storage_identifier__';
        }
    } else {
        $source =~ s{
            (?<![A-Za-z0-9_$.])
            (?:(?:window|globalThis)\.)?
            (?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\(\s*
            (["\x27]) secpal\.[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+ \1 (?=\s*[,)] )
        }{ my $key = $&; $key =~ s/secpal\.[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+/__secpal_storage_identifier__/; $key }gex;
    }
    my $line_number = 0;
    for my $line (split /\n/, $source, -1) {
        ++$line_number;
        print "$file:$line_number:$line\n" if $line =~ /secpal\.[A-Za-z0-9.-]{1,100}/;
    }
}
