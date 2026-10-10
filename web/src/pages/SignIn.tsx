// UC-13 Sign-in (demo; demo_accounts): the notice that all data are fictional demo data shared by everyone, a three-step
// tour (see Seoyeon's request → accept as Minho → approve as the owner) and every account with its role and weekly hours.
import { useState } from 'react';
import { rpc } from '../api';
import { Button, Chip, Hero, Icon, Notice, ScreenState, Sheet } from '../components/ui';
import { useAction, useScreen, useShell } from '../context';
import { useI18n } from '../i18n';
import { afterDemoReset, loadTour, saveTour } from '../store';
import type { DemoAccount } from '../types';

const STEPS = [
  { account: 2, to: '/swaps', title: 'tour.step1', hint: 'tour.step1Hint' },
  { account: 3, to: '/home', title: 'tour.step2', hint: 'tour.step2Hint' },
  { account: 1, to: '/home', title: 'tour.step3', hint: 'tour.step3Hint' },
] as const;

export function SignIn() {
  const i18n = useI18n();
  const { signIn, settings } = useShell();
  const act = useAction();
  const [tour, setTour] = useState<number[]>(loadTour);
  const [confirming, setConfirming] = useState(false);
  const screen = useScreen(() => rpc<DemoAccount[]>('demo_accounts'), []);
  const accounts = screen.data;
  const store = settings ? i18n.name(settings.workplace.name) : '';

  if (!accounts) {
    return <div className="screen" data-screen="signin" data-loaded="false"><ScreenState error={screen.error} onRetry={screen.reload} /></div>;
  }

  const enter = (id: number, to = '/home') => {
    const a = accounts.find((x) => x.id === id);
    if (a) signIn({ id: a.id, role: a.role, name: a.name }, to);
  };
  const current = STEPS.findIndex((_, i) => !tour.includes(i));
  const startStep = (i: number) => {
    const next = Array.from(new Set([...tour, i]));
    saveTour(next);
    setTour(next);
    enter(STEPS[i].account, STEPS[i].to);
  };
  const restart = async () => {
    const res = await act(() => rpc('reset_demo_data'), i18n.t('demo.resetDone'));
    if (res.ok) {
      afterDemoReset();
      setTour([]);
    }
    setConfirming(false);
  };
  const workers = accounts.filter((a) => a.role === 'WORKER').length;

  return (
    <div className="screen" data-screen="signin" data-loaded="true">
      <Hero title={i18n.t('signin.title', { store })} sub={i18n.t('signin.sub')} />
      <Notice icon="info" role="note"><p data-shared-notice>{i18n.t('signin.notice')}</p></Notice>

      <section className="card tour" aria-labelledby="tour-title">
        <div className="stack-tight">
          <h2 className="card-title" id="tour-title">{i18n.t('tour.title')}</h2>
          <p className="muted">{current === -1 ? i18n.t('tour.allDone') : i18n.t('tour.sub')}</p>
        </div>
        <ol className="tour-steps">
          {STEPS.map((s, i) => {
            const done = tour.includes(i);
            return (
              <li key={s.title} className={`tour-step ${done ? 'is-done' : ''} ${i === current ? 'is-current' : ''}`}>
                <span className="tour-num" aria-hidden="true">{done ? <Icon name="check" /> : <span className="num">{i + 1}</span>}</span>
                <div className="tour-text">
                  <strong>{i18n.t(s.title)}</strong>
                  <span className="muted">{i18n.t(s.hint)}</span>
                  {done && <span className="sr-only">{i18n.t('tour.done')}</span>}
                </div>
                <Button kind={i === current ? 'primary' : 'secondary'} small={i !== current} onClick={() => startStep(i)} data-step={i}>
                  {i === current ? i18n.t('tour.start') : done ? i18n.t('tour.again') : i18n.t('tour.open')}
                </Button>
              </li>
            );
          })}
        </ol>
        {current === -1 && (
          <div><Button kind="primary" block onClick={() => setConfirming(true)} id="tour-restart">{i18n.t('tour.restart')}</Button></div>
        )}
      </section>

      <section className="section" aria-labelledby="all-title">
        <h2 className="section-title" id="all-title">{i18n.t('signin.all')}</h2>
        <ul className="accounts">
          {accounts.map((a) => (
            <li key={a.id}>
              <button type="button" className="account" onClick={() => enter(a.id)} data-account={a.id}>
                <span className="avatar avatar-lg" aria-hidden="true">{i18n.initial(a.name)}</span>
                <span className="account-main">
                  <span className="account-name">{i18n.name(a.name)} <Chip tone={a.role === 'OWNER' ? 'ink' : 'neutral'}>{i18n.t(`role.${a.role}`)}</Chip></span>
                  <span className="account-summary">{a.role === 'OWNER'
                    ? i18n.t('signin.ownerSummary', { store, n: workers })
                    : a.fixed.length ? i18n.t('signin.workerSummary', { shifts: i18n.fixedSummary(a.fixed), h: i18n.hours(a.contract_hours ?? 0) })
                      : i18n.t('signin.noFixed')}</span>
                </span>
                <Icon name="chevronRight" className="chev" />
              </button>
            </li>
          ))}
        </ul>
      </section>
      {confirming && (
        <Sheet title={i18n.t('demo.reset')} onClose={() => setConfirming(false)}>
          <div className="confirm-box" role="alert">
            <p>{i18n.t('demo.resetConfirm')}</p>
            <div className="row-2">
              <Button kind="secondary" block onClick={() => setConfirming(false)}>{i18n.t('common.cancel')}</Button>
              <Button kind="danger" block onClick={restart} id="restart-yes">{i18n.t('demo.resetYes')}</Button>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}
