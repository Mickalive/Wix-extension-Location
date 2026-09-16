import { useState } from 'react';

const SMOKE_HEADER = 'preview-e2e-2026-09-16';

type SmokeResult = {
  ok?: boolean;
  stage?: string;
  error?: string;
  wixDataRoundTrip?: boolean;
  appointmentServiceCount?: number;
  calendar?: {
    applied?: boolean;
    verified?: boolean;
    rollbackComplete?: boolean;
    restored?: boolean;
    mismatches?: string[];
    rollbackNotes?: string[];
  };
};

export default function FunctionalSmokePanel() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SmokeResult | null>(null);
  const [transportError, setTransportError] = useState<string | null>(null);

  async function runSmoke() {
    setRunning(true);
    setResult(null);
    setTransportError(null);
    try {
      const { httpClient } = await import('@wix/essentials');
      const response = await httpClient.fetchWithAuth('/api/__functional-smoke', {
        method: 'GET',
        headers: { 'x-abr-functional-smoke': SMOKE_HEADER },
      });
      const text = await response.text();
      let body: SmokeResult;
      try {
        body = JSON.parse(text) as SmokeResult;
      } catch {
        throw new Error(`Diagnostic returned HTTP ${response.status} with a non-JSON body.`);
      }
      setResult(body);
    } catch (error) {
      setTransportError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  }

  const passed = Boolean(
    result?.ok === true &&
      result?.wixDataRoundTrip === true &&
      result?.calendar?.applied === true &&
      result?.calendar?.verified === true &&
      result?.calendar?.rollbackComplete === true &&
      result?.calendar?.restored === true,
  );

  return (
    <section
      style={{
        margin: '16px auto',
        maxWidth: 1180,
        padding: 16,
        border: '2px solid #116dff',
        borderRadius: 8,
        background: '#f7f9ff',
      }}
      aria-label="Temporary end-to-end diagnostic"
    >
      <strong>Temporary end-to-end Wix diagnostic</strong>
      <p>
        Runs a real Wix Data write/read, reads Wix Bookings, creates a temporary managed Calendar window,
        verifies it, then rolls it back and checks that the original state is restored.
      </p>
      <button
        type="button"
        onClick={() => void runSmoke()}
        disabled={running}
        style={{
          minHeight: 38,
          padding: '8px 14px',
          border: 0,
          borderRadius: 4,
          background: '#116dff',
          color: '#fff',
          cursor: running ? 'default' : 'pointer',
        }}
      >
        {running ? 'Running real Wix test…' : 'Run end-to-end functional test'}
      </button>

      {passed ? (
        <p role="status" style={{ fontWeight: 700 }}>
          PASS — Wix Data, Bookings, Calendar mutation, verification, rollback and exact restoration all succeeded.
        </p>
      ) : null}
      {!passed && result ? (
        <div role="alert" style={{ marginTop: 12 }}>
          <strong>FAIL</strong>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(result, null, 2)}</pre>
        </div>
      ) : null}
      {transportError ? (
        <p role="alert" style={{ marginTop: 12 }}>
          FAIL — {transportError}
        </p>
      ) : null}
    </section>
  );
}
