import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './lib/ThemeContext';
import Layout from './components/Layout';
import OverviewPage from './pages/OverviewPage';
import KanbanPage from './pages/KanbanPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import StatusPage from './pages/StatusPage';
import AdvisorPage from './pages/AdvisorPage';
import AutopilotPage from './pages/AutopilotPage';
import JournalPage from './pages/JournalPage';
import NotesPage from './pages/NotesPage';
import CorreoPage from './pages/CorreoPage';
import AlertsPage from './pages/AlertsPage';
import CalendarPage from './pages/CalendarPage';
import SchedulerPage from './pages/SchedulerPage';
import PulseConfigPage from './pages/PulseConfigPage';
import PulseDashboardPage from './pages/PulseDashboardPage';
import ResearchPage from './pages/ResearchPage';
import NewsletterConfigPage from './pages/NewsletterConfigPage';
import { initTelegramWebApp } from './lib/telegram';

function App() {
  useEffect(() => {
    initTelegramWebApp();
  }, []);

  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<OverviewPage />} />
            <Route path="kanban" element={<KanbanPage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="projects/:id" element={<ProjectDetailPage />} />
            <Route path="journal" element={<JournalPage />} />
            <Route path="notes" element={<NotesPage />} />
            <Route path="email" element={<CorreoPage />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="autopilot" element={<AutopilotPage />} />
            <Route path="pulse" element={<PulseDashboardPage />} />
            <Route path="pulse-config" element={<PulseConfigPage />} />
            <Route path="research" element={<ResearchPage />} />
            <Route path="scheduler" element={<SchedulerPage />} />
            <Route path="alerts" element={<AlertsPage />} />
            <Route path="status" element={<StatusPage />} />
            <Route path="advisor" element={<AdvisorPage />} />
            <Route path="newsletter" element={<NewsletterConfigPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
