/**
 * Upgrade entry point (BILL-C2-1-REPAIR; Contract §7 binding URL shape).
 */
import { describe, expect, it } from 'vitest';
import { buildUpgradeUrl } from '../../src/billing/upgrade/upgradeUrl';

describe('buildUpgradeUrl', () => {
  it('produces the byte-exact contracted upgrade URL', () => {
    // Contract §7: https://www.wix.com/apps/upgrade/<APP_ID>?appInstanceId=<INSTANCE_ID>
    expect(buildUpgradeUrl('test-app-id', 'test-instance-id')).toBe(
      'https://www.wix.com/apps/upgrade/test-app-id?appInstanceId=test-instance-id',
    );
  });

  it('rejects empty or whitespace-containing identifiers instead of building a broken CTA', () => {
    expect(() => buildUpgradeUrl('', 'test-instance-id')).toThrow(TypeError);
    expect(() => buildUpgradeUrl('test-app-id', '')).toThrow(TypeError);
    expect(() => buildUpgradeUrl('test app id', 'test-instance-id')).toThrow(TypeError);
    expect(() => buildUpgradeUrl('test-app-id', 'instance\tid')).toThrow(TypeError);
    expect(() => buildUpgradeUrl('   ', 'test-instance-id')).toThrow(TypeError);
  });
});
