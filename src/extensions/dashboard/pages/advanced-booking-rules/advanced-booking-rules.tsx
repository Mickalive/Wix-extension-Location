import type { FC } from 'react';
import AdvancedRulesApp from '../../runtime/AdvancedRulesApp';
import FunctionalSmokePanel from '../../runtime/FunctionalSmokePanel';

const DashboardPage: FC = () => (
  <>
    <FunctionalSmokePanel />
    <AdvancedRulesApp />
  </>
);

export default DashboardPage;
