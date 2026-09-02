import { useEffect, useState } from 'react';
import type { FC } from 'react';
import { dashboard } from '@wix/dashboard';
import { Box, CustomModalLayout, Text, WixDesignSystemProvider } from '@wix/design-system';
import '@wix/design-system/styles.global.css';
import config from './diff-confirm.config.ts';

type ReviewPayload = {
  hash: string;
  lines: string[];
  operationCount: number;
};

function normalizePayload(value: any): ReviewPayload | null {
  const candidate = value?.params ?? value;
  if (!candidate || typeof candidate.hash !== 'string' || !Array.isArray(candidate.lines)) return null;
  return {
    hash: candidate.hash,
    lines: candidate.lines.filter((line: unknown) => typeof line === 'string'),
    operationCount:
      typeof candidate.operationCount === 'number' ? candidate.operationCount : candidate.lines.length,
  };
}

const Modal: FC = () => {
  const [payload, setPayload] = useState<ReviewPayload | null>(null);

  useEffect(() => {
    const maybeUnsubscribe: any = dashboard.observeState((componentParams: any) => {
      setPayload(normalizePayload(componentParams));
    });
    return typeof maybeUnsubscribe === 'function' ? maybeUnsubscribe : undefined;
  }, []);

  const valid = Boolean(payload && payload.operationCount > 0 && payload.lines.length === payload.operationCount);

  return (
    <WixDesignSystemProvider>
      <CustomModalLayout
        width={config.width}
        maxHeight={config.height}
        primaryButtonText="Confirm exact changes"
        secondaryButtonText="Cancel"
        primaryButtonOnClick={() => {
          if (valid && payload) dashboard.closeModal({ confirmed: true, hash: payload.hash });
        }}
        secondaryButtonOnClick={() => dashboard.closeModal({ confirmed: false })}
        primaryButtonProps={{ disabled: !valid }}
        title="Confirm booking rule changes"
        subtitle="Only this exact reviewed diff can be applied. Editing the draft afterwards invalidates this confirmation."
        content={
          <Box direction="vertical" gap="SP3">
            {!payload ? (
              <Text>Waiting for the reviewed change set…</Text>
            ) : payload.lines.length === 0 ? (
              <Text>There are no changes to confirm.</Text>
            ) : (
              <>
                <Text weight="bold">{payload.operationCount} exact change{payload.operationCount === 1 ? '' : 's'}</Text>
                <ol style={{ margin: 0, paddingLeft: 24 }}>
                  {payload.lines.map((line, index) => (
                    <li key={`${payload.hash}-${index}`} style={{ marginBottom: 8 }}>
                      {line}
                    </li>
                  ))}
                </ol>
                <Text size="tiny">Consent reference: {payload.hash}</Text>
              </>
            )}
          </Box>
        }
      />
    </WixDesignSystemProvider>
  );
};

export default Modal;
