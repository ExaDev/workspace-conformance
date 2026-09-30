import type { LayoutConfig, RankSkipOptions } from '@exadev/config';
import { ConformanceError } from '../errors';
import type { WorkspacePackage } from './packages';

/**
 * A forbidden-dependency rule in the shape dependency-cruiser takes: a dependency from a file matching `from` to a file matching `to` is a violation.
 */
export interface ImportRule {
  readonly name: string;
  readonly severity: 'error';
  readonly comment: string;
  readonly from: { readonly path?: string };
  readonly to: { readonly path?: string; readonly circular?: boolean; readonly couldNotResolve?: boolean };
}

const REGEXP_SPECIAL = /[.*+?^${}()|[\]\\]/gu;

function escapeRegExp(text: string): string {
  return text.replace(REGEXP_SPECIAL, '\\$&');
}

/**
 * A regular expression, as source text, matching every file inside any of the packages. The trailing `/` keeps `packages/a` from matching `packages/ab`.
 */
export function packagesPattern(packages: readonly WorkspacePackage[]): string {
  return `^(${packages.map((member) => `${escapeRegExp(member.dir)}/`).join('|')})`;
}

/**
 * A regular expression, as source text, matching the name an import uses for any of the named packages: the name itself or a subpath of it. It matches nothing but those names, and is `undefined` when no package has a name.
 */
export function packageNamesPattern(packages: readonly WorkspacePackage[]): string | undefined {
  const names = packages.flatMap((member) => (member.name === undefined ? [] : [escapeRegExp(member.name)]));

  return names.length === 0 ? undefined : `^(${names.join('|')})(/|$)`;
}

/**
 * The paths a graph of these packages is limited to: their files, and the names other packages import them by. An import that dependency-cruiser cannot resolve to a file (a package whose entry point is not built, or a workspace that is not installed) is known to it only by that name.
 */
export function graphScopePattern(packages: readonly WorkspacePackage[]): string {
  const names = packageNamesPattern(packages);

  return names === undefined ? packagesPattern(packages) : `${packagesPattern(packages)}|${names}`;
}

/**
 * The rules that forbid files of `from` to import `to`: one for the files the packages resolve to and, when any of them has a name, one for an import of the name that cannot be resolved to a file. Both are named after `name`, which is also each rule's comment prefix.
 */
function forbid(name: string, comment: string, from: readonly WorkspacePackage[], to: readonly WorkspacePackage[]): readonly ImportRule[] {
  const names = packageNamesPattern(to);
  const byPath: ImportRule = { name, severity: 'error', comment, from: { path: packagesPattern(from) }, to: { path: packagesPattern(to) } };

  return names === undefined
    ? [byPath]
    : [byPath, { name: `${name}-by-name`, severity: 'error', comment, from: { path: packagesPattern(from) }, to: { path: names, couldNotResolve: true } }];
}

function groupBy<Key>(packages: readonly WorkspacePackage[], keyOf: (member: WorkspacePackage) => Key | undefined): ReadonlyMap<Key, readonly WorkspacePackage[]> {
  const groups = new Map<Key, WorkspacePackage[]>();
  for (const member of packages) {
    const key = keyOf(member);
    if (key === undefined) {
      continue;
    }
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, [member]);
    } else {
      existing.push(member);
    }
  }

  return groups;
}

/**
 * A package's rank, or a `ConformanceError` naming every package that has none. A rank check that skipped an unranked package would look clean while checking less.
 */
export function ranked(packages: readonly WorkspacePackage[]): readonly (WorkspacePackage & { readonly rank: number })[] {
  const unranked = packages.filter((member) => member.rank === undefined);
  if (unranked.length > 0) {
    throw new ConformanceError(
      `no rank resolves for ${unranked.map((member) => member.dir).join(', ')}; give the group a rank, add a matching nameRanks pattern, or set defaultRank in the layout`,
    );
  }

  return packages.flatMap((member) => (member.rank === undefined ? [] : [{ ...member, rank: member.rank }]));
}

/**
 * One rule per rank that has a higher rank above it: files of a package at that rank may not import a package at a strictly higher rank. A rule compares no numbers, so the ordering is expanded into path alternations here. Each rule comes with a `-by-name` rule for imports that do not resolve to a file.
 */
export function uphillRules(packages: readonly WorkspacePackage[]): readonly ImportRule[] {
  const members = ranked(packages);
  const byRank = groupBy(members, (member) => member.rank);

  return [...byRank.entries()].sort(([a], [b]) => a - b).flatMap(([rank, own]): readonly ImportRule[] => {
    const higher = members.filter((member) => member.rank > rank);

    return higher.length === 0 ? [] : forbid(`uphill-rank-${String(rank)}`, `a package of rank ${String(rank)} may not import a package of a higher rank`, own, higher);
  });
}

/**
 * One rule per rank with a package more than `rankSkip.maxDistance` ranks below it that is not an exempt rank.
 */
export function rankSkipRules(packages: readonly WorkspacePackage[], rankSkip: RankSkipOptions): readonly ImportRule[] {
  const members = ranked(packages);
  const byRank = groupBy(members, (member) => member.rank);

  return [...byRank.entries()].sort(([a], [b]) => a - b).flatMap(([rank, own]): readonly ImportRule[] => {
    const skipped = members.filter((member) => member.rank < rank - rankSkip.maxDistance && !rankSkip.exemptRanks.includes(member.rank));

    return skipped.length === 0
      ? []
      : forbid(
          `rank-skip-${String(rank)}`,
          `a package of rank ${String(rank)} may import at most ${String(rankSkip.maxDistance)} rank(s) below it, apart from the exempt ranks`,
          own,
          skipped,
        );
  });
}

/**
 * One rule per slice: a package in it may not import a package that has a different slice. A package without a slice is in none and is never restricted.
 */
export function crossSliceRules(packages: readonly WorkspacePackage[]): readonly ImportRule[] {
  const bySlice = groupBy(packages, (member) => member.slice);

  return [...bySlice.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([slice, own]): readonly ImportRule[] => {
    const others = packages.filter((member) => member.slice !== undefined && member.slice !== slice);

    return others.length === 0 ? [] : forbid(`cross-slice-${slice}`, `a package in the '${slice}' slice may not import a package in another slice`, own, others);
  });
}

/**
 * Two rules per isolated pair, one for each direction.
 */
export function isolatedGroupRules(packages: readonly WorkspacePackage[], isolatedGroups: NonNullable<LayoutConfig['isolatedGroups']>): readonly ImportRule[] {
  const byGroup = groupBy(packages, (member) => member.group);

  return isolatedGroups.flatMap(([first, second]) =>
    [
      { from: first, to: second },
      { from: second, to: first },
    ].flatMap(({ from, to }): readonly ImportRule[] => {
      const own = byGroup.get(from);
      const other = byGroup.get(to);

      return own === undefined || other === undefined ? [] : forbid(`isolated-${from}-${to}`, `the '${from}' group may not import the '${to}' group`, own, other);
    }),
  );
}

/**
 * The rule that forbids any import cycle among the packages' files.
 */
export function cycleRule(): ImportRule {
  return { name: 'import-cycle', severity: 'error', comment: 'files may not import each other in a cycle', from: {}, to: { circular: true } };
}
