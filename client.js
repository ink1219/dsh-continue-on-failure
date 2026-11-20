window.__ModuleLoader__.load({
  id: 'dsh-continue-on-failure',
  factory(require) {
    const React = require('react');
    const { useState, useEffect, useCallback, useRef } = React;
    const h = React.createElement;

    const NS = 'continue-on-failure';

    const zh = {
      'action.retry': '重试',
      'action.retryActive': '正在重新生成…',
      'action.continue': '继续',
      'action.continueActive': '正在继续…',
      'action.continueHint': '上一轮模型请求失败，点一下即可接着跑，不用手打',
      'dock.hint': '上一轮模型请求失败了，点「继续」直接重发',
      'error.retry': '重试失败',
      'error.continue': '继续失败',
      'meta.title': '失败后继续',
      'meta.description': '模型请求失败后，在输入框上方显示「继续」按钮，点一下即可接着跑，不用手动重新输入。',
    };
    const en = {
      'action.retry': 'Retry',
      'action.retryActive': 'Regenerating…',
      'action.continue': 'Continue',
      'action.continueActive': 'Continuing…',
      'action.continueHint': 'The last model request failed. Click to resume without typing.',
      'dock.hint': 'The last model request failed. Press Continue to resend it.',
      'error.retry': 'Retry failed',
      'error.continue': 'Continue failed',
      'meta.title': 'Continue after failure',
      'meta.description': 'Shows a Continue button above the composer after a failed model request, so you can resume with one click instead of retyping.',
    };

    const RETRY_ICON = h('svg', {
      viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
      strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
      style: { width: '15px', height: '15px', flex: 'none' }, 'aria-hidden': true,
    },
      h('path', { d: 'M23 4v6h-6' }),
      h('path', { d: 'M1 20v-6h6' }),
      h('path', { d: 'M3.5 9a9 9 0 0 1 15-3L23 10' }),
      h('path', { d: 'M1 14l4.5 4A9 9 0 0 0 20.5 15' })
    );

    /** Extract plain text from content blocks. */
    function textOfContent(content) {
      if (typeof content === 'string') return content;
      if (!Array.isArray(content)) return '';
      const parts = [];
      for (const block of content) {
        if (block && typeof block === 'object' && typeof block.text === 'string') parts.push(block.text);
      }
      return parts.join('').trim();
    }

    /** Unwrap a `RemoteResult` (`{ok,value}` / `{ok:false,error}`) used by all Remote calls. */
    function unwrap(result) {
      if (!result || typeof result !== 'object') return result;
      if (typeof result.ok !== 'boolean') return result; // already a plain value
      if (result.ok) return result.value;
      throw result.error instanceof Error ? result.error : new Error(String(result.error));
    }

    /** Durable feed records are `{ type: 'event', event }` per the events schema. */
    function innerEvent(item) {
      if (!item || typeof item !== 'object') return null;
      if (item.event && typeof item.event === 'object' && typeof item.event.type === 'string') return item.event;
      return typeof item.type === 'string' ? item : null;
    }

    /** Mirror the shipped Chat `endFailure()`: only these turn/end reasons are failures. */
    function isFailureReason(reason) {
      if (!reason || typeof reason !== 'object') return false;
      switch (reason.kind) {
        case 'error':
          return true;
        case 'interrupted':
          return true;
        case 'aborted':
          return Boolean(reason.reason && reason.reason.kind === 'hook' &&
            reason.reason.reason === 'deepseek-account/signed-out');
        default:
          return false;
      }
    }

    /**
     * A turn failed when its latest `turn/end` carries a failure reason.
     * Older successful turns are ignored, so the button disappears after recovery.
     */
    function judgeEvents(events) {
      let sawUserTurn = false;
      let lastOutcome = null; // 'ok' | 'fail'
      for (const event of events) {
        if (!event) continue;
        const type = event.type;
        if (type === 'user/message') sawUserTurn = true;
        if (type === 'turn/end') {
          lastOutcome = isFailureReason(event.data && event.data.reason) ? 'fail' : 'ok';
        }
      }
      return { needsContinue: sawUserTurn && lastOutcome === 'fail', sawUserTurn };
    }

    /** Read the last user message text from session history. */
    function lastUserText(events) {
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        if (ev && ev.type === 'user/message') {
          const src = ev.data && ev.data.source;
          if (!src || src.kind === 'user') return textOfContent(ev.data && ev.data.content);
        }
      }
      return '';
    }

    async function readEvents(remote, sessionId) {
      const request = { address: { kind: 'session', sessionId }, maxMessages: 80 };
      let page;
      try {
        page = unwrap(await remote.session.events(request));
      } catch (err) {
        // Some client builds expose the equivalent legacy `page` method instead.
        console.error('[continue-on-failure] events failed, trying page:', err);
        page = unwrap(await remote.session.page(request));
      }
      const records = (page && Array.isArray(page.records)) ? page.records : [];
      const events = [];
      for (const record of records) {
        const ev = innerEvent(record);
        if (ev) events.push(ev);
      }
      return events;
    }

    /** `running` lives on the session state snapshot; tolerate shape changes. */
    async function readRunning(remote, sessionId) {
      try {
        const state = unwrap(await remote.session.state({ sessionId }));
        if (!state || typeof state !== 'object') return null;
        if (typeof state.running === 'boolean') return state.running;
        if (typeof state.status === 'string') return state.status === 'running';
        return null;
      } catch {
        return null;
      }
    }

    // Styling follows the host QueueDock panel: same radius, menu fill, hairline
    // border, and control metrics, so the card reads as a native surface.
    const DOCK_CSS = [
      '.dshRetryDock{box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));max-width:calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));margin:0 auto calc(0px - var(--dsh-composer-stack-gap) - 3px);padding:0 var(--dsh-composer-dock-inset);flex:none;display:flex;justify-content:flex-end}',
      '.dshRetryCard{isolation:isolate;box-sizing:border-box;border-radius:var(--dsw-radius-lg);align-items:center;gap:10px;display:flex;max-width:100%;padding:4px 6px 4px 14px;position:relative}',
      '.dshRetryCard:before{z-index:-1;border-radius:inherit;background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);content:"";pointer-events:none;position:absolute;inset:0}',
      '.dshRetryCard:after{border:.5px solid var(--dsw-alias-border-l1);border-radius:inherit;content:"";pointer-events:none;position:absolute;inset:0}',
      '.dshRetryText{min-width:0;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-13,13px);line-height:24px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dshRetryButton{box-sizing:border-box;height:28px;border-radius:var(--dsw-radius-md,8px);border:none;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;align-items:center;gap:6px;padding:0 10px;font-size:13px;font-weight:500;line-height:20px;display:inline-flex;flex:none}',
      '@media (hover:hover){.dshRetryButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}}',
      '.dshRetryButton:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}',
      '.dshRetryButton:disabled{cursor:default;opacity:.45}',
      '.dshRetryButtonPrimary{color:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary))}',
      '.dshRetryError{color:var(--dsw-alias-state-error-primary);font:var(--dsw-font-xs-13,13px);line-height:24px;flex:none}',
    ].join('\n');

    /** The failure-aware "Continue" card, shown above the composer after a failed turn. */
    function ContinueDock({ sessionId, t, remote }) {
      const [visible, setVisible] = useState(false);
      const [pending, setPending] = useState(false);
      const [failure, setFailure] = useState(null);
      const busy = useRef(false);

      useEffect(() => {
        if (!sessionId) return undefined;
        let alive = true;
        const scan = async () => {
          if (busy.current || !alive) return;
          busy.current = true;
          try {
            const [events, running] = await Promise.all([
              readEvents(remote, sessionId),
              readRunning(remote, sessionId),
            ]);
            if (!alive) return;
            const verdict = judgeEvents(events);
            setVisible(verdict.needsContinue && running !== true);
          } catch {
            if (alive) setVisible(false);
          } finally {
            busy.current = false;
          }
        };
        scan();
        const timer = setInterval(scan, 2000);
        return () => {
          alive = false;
          clearInterval(timer);
        };
      }, [sessionId, remote]);

      const onContinue = useCallback(async () => {
        setPending(true);
        setFailure(null);
        try {
          await unwrap(remote.session.prompt({
            sessionId,
            content: [{ type: 'text', text: t('action.continue') }],
            requestId: 'continue-' + String(Date.now()),
            mode: 'queue',
          }));
          // Do not permanently hide: if this retry also fails, the button reappears.
          setVisible(false);
        } catch (error) {
          setFailure(error instanceof Error ? error.message : String(error));
        } finally {
          setPending(false);
        }
      }, [sessionId, remote, t]);

      const style = h('style', { dangerouslySetInnerHTML: { __html: DOCK_CSS } });
      if (!visible) {
        if (failure === null) return style;
        return h(React.Fragment, null, style, h('div', { className: 'dshRetryDock', role: 'status' },
          h('div', { className: 'dshRetryCard' },
            h('span', { className: 'dshRetryError' }, t('error.continue')))));
      }

      return h(React.Fragment, null, style, h('div', { className: 'dshRetryDock' },
        h('div', { className: 'dshRetryCard' },
          h('span', { className: 'dshRetryText' }, t('dock.hint')),
          failure !== null && h('span', { className: 'dshRetryError', role: 'status' }, t('error.continue')),
          h('button', {
            type: 'button',
            className: 'dshRetryButton dshRetryButtonPrimary',
            'aria-label': pending ? t('action.continueActive') : t('action.continue'),
            title: pending ? t('action.continueActive') : t('action.continueHint'),
            disabled: pending,
            onClick: onContinue,
          }, pending ? t('action.continueActive') : t('action.continue'))
        )
      ));
    }

    /** The per-message Retry action, kept on finalized assistant messages. */
    function RetryAction({ sessionId, t, retry }) {
      const [pending, setPending] = useState(false);
      const [failure, setFailure] = useState(null);

      const onRetry = useCallback(async () => {
        setPending(true);
        setFailure(null);
        try {
          await retry(sessionId);
        } catch (error) {
          setFailure(error instanceof Error ? error.message : String(error));
        } finally {
          setPending(false);
        }
      }, [sessionId, retry]);

      const label = pending ? t('action.retryActive') : t('action.retry');
      return h(React.Fragment, null,
        h('button', {
          type: 'button',
          'aria-label': label,
          title: label,
          disabled: pending,
          onClick: onRetry,
          style: {
            width: '32px',
            height: '32px',
            borderRadius: '6px',
            border: '1px solid var(--dsw-alias-border-l1, #d0d5dd)',
            background: pending ? 'var(--dsw-alias-bg-layer-2, #e5e7eb)' : 'transparent',
            color: 'var(--dsw-alias-label-secondary, #4b5563)',
            cursor: pending ? 'default' : 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0',
          },
        }, RETRY_ICON),
        failure !== null && h('span', { role: 'status', style: { color: 'var(--dsw-alias-state-error-primary, #ef4444)', fontSize: '12px', marginLeft: '6px' } }, t('error.retry'))
      );
    }

    /** Older slots inject a bare sessionId; newer ones inject the owner props object. */
    function sessionIdOf(arg) {
      if (typeof arg === 'string') return arg;
      if (arg && typeof arg === 'object') return arg.sessionId || (arg.session && arg.session.id) || null;
      return null;
    }

    return {
      inject: ['slots', 'remote', 'remote.session', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'continue-on-failure: dictionaries');
        const t = ctx.locale.bind(NS);

        // 1) The failure-aware "Continue" card above the composer.
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'continue-on-failure',
          order: 5,
          locale: NS,
          inject: (owner) => ({ sessionId: sessionIdOf(owner), t, remote: ctx.remote }),
        }, ContinueDock));

        // 2) The per-message Retry action.
        ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
          name: 'conversation.chat.assistant-actions',
          id: 'retry',
          order: 15,
          locale: NS,
          inject: (owner) => ({
            sessionId: sessionIdOf(owner),
            t,
            retry: async (id) => {
              const events = await readEvents(ctx.remote, id);
              const text = lastUserText(events);
              if (!text) throw new Error('no user message to retry');
              await unwrap(ctx.remote.session.prompt({
                sessionId: id,
                content: [{ type: 'text', text }],
                requestId: 'retry-' + String(Date.now()),
                mode: 'queue',
              }));
            },
          }),
        }, RetryAction));
      },
    };
  },
});
