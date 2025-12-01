import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {toast} from 'sonner'
import { Music, Users } from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { API } from "@/App";

const Landing = () => {
  const navigate = useNavigate();
  const [mode, setMode] = useState<null | 'partygoer' | 'dj'>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLogin, setIsLogin] = useState(true);
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);

  const handleDJAuth = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const endpoint = isLogin ? "/auth/login" : "/auth/register";
      const data = await fetch(`${API}${endpoint}`, { body: JSON.stringify({ email, password }), method: "POST", headers: { "Content-Type": "application/json" } }).then(async (res) => {
        if(!res.ok) {
          const msg = await res.text();
          throw new Error(msg)
        }

        return res.json()
      });

      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      toast.success(isLogin ? "Logged in successfully!" : "Account created!");
      navigate("/dj-dashboard");
    } catch (error) {
        if(error instanceof Error)
            toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleJoinRoom = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pin.length !== 4) {
      toast.error("Please enter a 4-digit PIN");
      return;
    }
    
    setLoading(true);
    try {
      await fetch(`${API}/rooms/${pin}`)
      navigate(`/room/${pin}`);
    } catch (error) {
      toast.error("Room not found or closed");
    } finally {
      setLoading(false);
    }
  };

  if (!mode) {
    return (
      <div className="landing-container">
        <div className="neon-glow"></div>
        <div className="landing-content">
          <div className="logo-section">
            <Music className="logo-icon" size={64} />
            <h1 className="app-title">DJ Jukebox</h1>
            <p className="app-subtitle">Let the crowd choose the vibe</p>
          </div>
          
          <div className="mode-selection">
            <Button
              data-testid="dj-mode-btn"
              className="mode-btn dj-btn" 
              onClick={() => setMode('dj')}
            >
              <Music size={24} />
              I'm the DJ
            </Button>
            <Button 
              data-testid="partygoer-mode-btn"
              className="mode-btn partygoer-btn" 
              onClick={() => setMode('partygoer')}
            >
              <Users size={24} />
              Join the Party
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'dj') {
    return (
      <div className="auth-container">
        <div className="neon-glow"></div>
        <Card className="auth-card">
          <CardHeader>
            <CardTitle className="auth-title">
              {isLogin ? "DJ Login" : "Create DJ Account"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleDJAuth} className="auth-form">
              <Input
                data-testid="email-input"
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="auth-input"
              />
              <Input
                data-testid="password-input"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="auth-input"
              />
              <Button 
                data-testid="auth-submit-btn"
                type="submit" 
                className="auth-submit-btn" 
                disabled={loading}
              >
                {loading ? "Processing..." : (isLogin ? "Login" : "Register")}
              </Button>
              <button
                data-testid="toggle-auth-mode-btn"
                type="button"
                className="toggle-auth"
                onClick={() => setIsLogin(!isLogin)}
              >
                {isLogin ? "Need an account? Register" : "Have an account? Login"}
              </button>
              <button
                data-testid="back-btn"
                type="button"
                className="back-link"
                onClick={() => setMode(null)}
              >
                Back
              </button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="neon-glow"></div>
      <Card className="auth-card">
        <CardHeader>
          <CardTitle className="auth-title">Join a Room</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleJoinRoom} className="auth-form">
            <Input
              data-testid="pin-input"
              type="text"
              placeholder="Enter 4-digit PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              maxLength={4}
              required
              inputMode="numeric"
              className="auth-input pin-input"
            />
            <Button 
              data-testid="join-room-btn"
              type="submit" 
              className="auth-submit-btn" 
              disabled={loading}
            >
              {loading ? "Joining..." : "Join Room"}
            </Button>
            <button
              type="button"
              className="back-link"
              onClick={() => setMode(null)}
            >
              Back
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default Landing