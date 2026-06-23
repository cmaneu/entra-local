import type { ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import axe from 'axe-core';
import { ShellProvider } from '../hooks/useToast';
import { EmulatorProvider } from '../components/EmulatorContext';

interface RenderOptions {
  /** Route pattern the element is mounted at (defaults to a catch-all). */
  path?: string;
  /** Router history (defaults to `['/']`). */
  initialEntries?: string[];
}

/** Render a portal node inside the shell providers + an in-memory router. */
export function renderWithProviders(
  node: ReactElement,
  { path = '*', initialEntries = ['/'] }: RenderOptions = {},
): RenderResult {
  return render(
    <ShellProvider>
      <EmulatorProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route path={path} element={node} />
          </Routes>
        </MemoryRouter>
      </EmulatorProvider>
    </ShellProvider>,
  );
}

/**
 * Assert the given container has no critical/serious axe violations. Color-contrast is disabled
 * (jsdom has no layout engine, so it cannot be evaluated reliably).
 */
export async function expectNoCriticalAxe(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false } },
  });
  const serious = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  if (serious.length > 0) {
    const summary = serious
      .map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s) — ${v.help}`)
      .join('\n');
    throw new Error(`axe found ${serious.length} serious/critical violation(s):\n${summary}`);
  }
}
