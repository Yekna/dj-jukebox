import { Toaster } from 'sonner'
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Landing from './components/landing'
import './App.css'
import DJDashboard from './components/dj-dashboard';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export type Song = { status: 'pending' | 'approved' | 'played' | 'rejected', video_id: string; id: string, thumbnail: string, title: string, submitter_name: string, votes: number, youtube_url: string }
export type Room = null | { pin: string, dj_email: string }

function App() {
  return (
    <>
      <Toaster position="top-center" richColors />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/dj-dashboard" element={<DJDashboard />} />
        </Routes>
      </BrowserRouter>
    </>
  )
}

export default App
