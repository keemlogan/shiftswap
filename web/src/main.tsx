import { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import './index.css';
import { createI18n, I18nContext, type Lang } from './i18n';
import { loadLang, saveLang } from './store';
import { Shell } from './Shell';
import { SignIn } from './pages/SignIn';
import { Home } from './pages/Home';
import { Schedule } from './pages/Schedule';
import { Swaps } from './pages/Swaps';
import { SwapFlow } from './pages/SwapFlow';
import { Me } from './pages/Me';
import { StaffDetail, StaffList } from './pages/Staff';
import { Pay } from './pages/Pay';
import { SettingsPage } from './pages/Settings';
import { NotificationsPage } from './pages/Notifications';

function App() {
  const [lang, setLangState] = useState<Lang>(loadLang);
  const setLang = useCallback((next: Lang) => {
    saveLang(next);
    setLangState(next);
  }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const value = useMemo(() => ({ i18n: createI18n(lang), setLang }), [lang, setLang]);
  return (
    <I18nContext.Provider value={value}>
      <HashRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route path="/login" element={<SignIn />} />
            <Route path="/home" element={<Home />} />
            <Route path="/schedule/:week?" element={<Schedule />} />
            <Route path="/swaps" element={<Swaps />} />
            <Route path="/swaps/new/:step/:shiftId?" element={<SwapFlow />} />
            <Route path="/me" element={<Me />} />
            <Route path="/staff" element={<StaffList />} />
            <Route path="/staff/:id" element={<StaffDetail />} />
            <Route path="/pay" element={<Navigate to="/pay/week" replace />} />
            <Route path="/pay/:tab/:period?" element={<Pay />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="*" element={<Navigate to="/home" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </I18nContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
