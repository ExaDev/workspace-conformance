import { layoutSection, withSections } from '@exadev/config';
import { conformanceSection } from 'workspace-conformance';

export default withSections(
  layoutSection,
  conformanceSection,
)({
  layout: {
    root: '../imports/violating',
    groups: [
      { name: 'core', rank: 0 },
      { name: 'features', rank: 1, slice: { segment: 0 } },
      { name: 'product', rank: 2, slice: { segment: 0 } },
    ],
  },
  conformance: { checks: { 'import-uphill': {}, 'single-storybook': {} } },
});
