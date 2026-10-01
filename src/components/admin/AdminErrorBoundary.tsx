"use client";

import { Component, type ReactNode } from "react";

/**
 * Contains a crash to one admin panel or tab. Without it, any unexpected
 * value from the database (e.g. a SQL array that comes back null) throws
 * during render and Next replaces the whole page with "This page couldn't
 * load" — which is what happened with the 🔔 panel on 2026-10-02.
 */
export default class AdminErrorBoundary extends Component<
  { name: string; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[admin] ${this.props.name} crashed`, error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
        <p className="font-semibold">⚠️ {this.props.name}을(를) 표시하는 중 오류가 났습니다. 다른 탭은 그대로 쓸 수 있어요.</p>
        <p className="mt-1 font-mono text-rose-200/70">{this.state.error.message}</p>
        <button type="button" onClick={() => this.setState({ error: null })} className="mt-2 underline">
          다시 시도
        </button>
      </div>
    );
  }
}
