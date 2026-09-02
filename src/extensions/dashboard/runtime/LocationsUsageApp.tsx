import { useEffect, useMemo, useState } from 'react';
import { Page, WixDesignSystemProvider } from '@wix/design-system';
import '@wix/design-system/styles.global.css';
import { createRuntimeServicesBridge } from '../../../ui/services/ruleSetRuntime.js';
import { describeBridgeFailure } from '../../../ui/state/editorStore.js';

const panelStyle: React.CSSProperties = {
  border: '1px solid #dfe5eb',
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
  background: '#fff',
};

type MeterDto = {
  meter: { count: number | null; degraded: boolean };
  coverage: {
    allowedLocationIds: string[];
    overLimit: boolean;
    degraded: boolean;
    warning: string | null;
  };
};

export default function LocationsUsageApp() {
  const bridge = useMemo(() => createRuntimeServicesBridge(), []);
  const [dto, setDto] = useState<MeterDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void bridge
      .getEntitlementMeter()
      .then((value: MeterDto | null) => {
        if (!cancelled) setDto(value);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(describeBridgeFailure(reason, 'Loading usage'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  return (
    <WixDesignSystemProvider>
      <Page>
        <Page.Header
          title="Locations Usage"
          subtitle="See which Wix Bookings locations are managed by your current app plan."
        />
        <Page.Content>
          <div style={{ maxWidth: 960, margin: '0 auto', paddingBottom: 32 }}>
            {loading ? <p role="status">Loading location usage…</p> : null}
            {error ? <p role="alert">{error}</p> : null}
            {!loading && !error && dto === null ? (
              <p role="status">Usage information is not available yet. Your booking rules remain available.</p>
            ) : null}
            {dto ? (
              <>
                {(dto.coverage.degraded || dto.meter.degraded || dto.coverage.warning) ? (
                  <section style={{ ...panelStyle, borderColor: '#e4a11b' }} role="alert">
                    <strong>Usage data is degraded</strong>
                    <p>
                      {dto.coverage.warning ??
                        'Some location usage data is temporarily unavailable. Enforcement fails open rather than blocking bookings on unreliable coverage data.'}
                    </p>
                  </section>
                ) : null}

                <section style={panelStyle} aria-label="Counted locations">
                  <h2>Counted locations</h2>
                  <p>
                    {dto.meter.count === null
                      ? 'The location count cannot be read right now.'
                      : `${dto.meter.count} location${dto.meter.count === 1 ? '' : 's'} currently count toward this app.`}
                  </p>
                  {dto.meter.count === 0 ? (
                    <p>Billing still treats a zero-location site as one managed location.</p>
                  ) : null}
                  {dto.coverage.overLimit ? (
                    <p role="alert">
                      This site is over the plan limit. Existing configuration is preserved; locations outside the covered set are not silently deleted.
                    </p>
                  ) : (
                    <p>All counted locations are within the currently resolved plan coverage.</p>
                  )}
                </section>

                <section style={panelStyle} aria-label="Covered location IDs">
                  <h2>Covered locations</h2>
                  <p>Coverage order is stable: default location first, then alphabetical.</p>
                  {dto.coverage.allowedLocationIds.length ? (
                    <ol>
                      {dto.coverage.allowedLocationIds.map((id) => (
                        <li key={id}>{id}</li>
                      ))}
                    </ol>
                  ) : (
                    <p>No location IDs are currently reported as covered.</p>
                  )}
                </section>
              </>
            ) : null}
          </div>
        </Page.Content>
      </Page>
    </WixDesignSystemProvider>
  );
}
