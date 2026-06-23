import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { EmulatorProvider } from './components/EmulatorContext';
import { ShellProvider } from './hooks/useToast';
import { Dashboard } from './routes/Dashboard';
import { Users } from './routes/Users';
import { Groups } from './routes/Groups';
import { Apps } from './routes/Apps';
import { AppDetail } from './routes/AppDetail';

/** Portal root: providers + the routed app shell. */
export function App(): JSX.Element {
  return (
    <ShellProvider>
      <EmulatorProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<Dashboard />} />
              <Route path="users" element={<Users />} />
              <Route path="groups" element={<Groups />} />
              <Route path="apps" element={<Apps />} />
              <Route path="apps/:id" element={<AppDetail />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </EmulatorProvider>
    </ShellProvider>
  );
}
