/**
 * Explain panel — renders rule outcomes produced by the typed domain
 * Explanation DTO (`src/shared/types.ts`: decision, ruleId, code,
 * customerMessage). The dashboard never re-implements evaluation semantics;
 * it displays outcomes verbatim, customer message first.
 *
 * Until the backend wiring lands (Rules lane ACCEPT + platform services), the
 * panel shows an honest empty state instead of pretending to evaluate.
 */

import { el } from '../dom/kit.js';

/**
 * @param {Array<{decision:'allow'|'block',ruleId:string,code:string,customerMessage:string}>} explanations
 * @param {{document?: UiDocument}} [options]
 */
export function renderExplainPanel(explanations, options = {}) {
  const list = Array.isArray(explanations) ? explanations : [];

  if (list.length === 0) {
    return el(
      'section',
      {
        'data-testid': 'explain-panel',
        'aria-label': 'Rule outcome explanations',
      },
      el('h3', { text: 'Why a booking was allowed or blocked' }),
      el('p', {
        'data-testid': 'explain-empty',
        text: 'No rule outcomes to explain yet. Once the app is connected, every allowed or blocked booking appears here with the exact reason.',
      }),
    );
  }

  return el(
    'section',
    {
      'data-testid': 'explain-panel',
      'aria-label': 'Rule outcome explanations',
    },
    el('h3', { text: 'Why a booking was allowed or blocked' }),
    el(
      'ul',
      { 'data-testid': 'explain-list' },
      ...list.map((explanation) =>
        el(
          'li',
          { 'data-testid': 'explain-entry', class: `explain-${explanation.decision}` },
          el('span', {
            'data-testid': 'explain-decision',
            text: explanation.decision === 'block' ? 'Blocked' : 'Allowed',
          }),
          el('span', {
            'data-testid': 'explain-message',
            text: explanation.customerMessage,
          }),
          el('code', {
            'data-testid': 'explain-code',
            text: `${explanation.ruleId}:${explanation.code}`,
          }),
        ),
      ),
    ),
  );
}
