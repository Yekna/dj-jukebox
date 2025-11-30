import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from 'sonner';
import QRCode from "qrcode";
import { Music, ThumbsUp, Play, X, Check, LogOut } from "lucide-react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { API } from "@/App";
import type { Room, Song } from "@/App";

const DJDashboard = () => {
  const navigate = useNavigate();
  const [room, setRoom] = useState<Room>(null);

  // todo: don't use state check out how you rendered stuff from the websocket in different folder
  const [songs, setSongs] = useState<Array<Song>>([]);

  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const wsRef = useRef<null | WebSocket>(null);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      navigate("/");
      return;
    }
    createOrGetRoom();
  }, []);

  useEffect(() => {
    if (room) {
      connectWebSocket();
      loadSongs();
      generateQRCode();
    }
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [room]);

  const createOrGetRoom = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      if (token === 'undefined' || !token) {
        throw new Error("Token not created")
      }
      const data = await fetch(
        `${API}/rooms/create`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({})
        },
      ).then(res => res.json());
      setRoom(data);
    } catch (error) {
      toast.error("Failed to create room");
      navigate("/");
    } finally {
      setLoading(false);
    }
  };

  const connectWebSocket = () => {
    const wsUrl = `${API.replace('https', 'wss').replace('http', 'ws')}/ws/${room?.pin}`;
    wsRef.current = new WebSocket(wsUrl);

    wsRef.current.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'song_requested' || data.type === 'song_voted' || data.type === 'song_status_changed') {
        loadSongs();
      }
    };
  };

  const loadSongs = async () => {
    try {
      const data = await fetch(`${API}/rooms/${room?.pin}/songs`).then(res => res.json());
      if (!data?.songs) {
        throw new Error("No songs found. Probably a problem on our part")
      }
      setSongs(data.songs);
    } catch (error) {
      console.error("Failed to load songs", error);
    }
  };

  const generateQRCode = async () => {
    const roomUrl = `${window.location.origin}/room/${room?.pin}`;
    try {
      const qrDataUrl = await QRCode.toDataURL(roomUrl, {
        width: 300,
        margin: 2,
        color: {
          dark: '#0a0a0f',
          light: '#00ff88'
        }
      });
      setQrCodeUrl(qrDataUrl);
    } catch (error) {
      console.error("Failed to generate QR code", error);
    }
  };

  const updateSongStatus = async (songId: string, status: string) => {
    try {
      const token = localStorage.getItem("token");
      await fetch(`${API}/songs/${songId}/status`, { method: "PATCH", body: JSON.stringify({ status }), headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } })
      toast.success(`Song ${status}`);
    } catch (error) {
      toast.error("Failed to update song status");
    }
  };

  const closeRoom = async () => {
    try {
      const token = localStorage.getItem("token");
      localStorage.removeItem(`session_${room?.pin}`)
      await fetch(`${API}/rooms/${room?.pin}/close`, { method: "POST", body: JSON.stringify({}), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } })
      toast.success("Room closed");
      wsRef.current?.close();
      navigate("/");
    } catch (error) {
      toast.error("Failed to close room");
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/");
  };

  if (loading || !room) {
    return <div className="loading-screen">Setting up your room...</div>;
  }

  const pendingSongs = songs.filter(s => s?.status === 'pending');
  const approvedSongs = songs.filter(s => s?.status === 'approved');
  const playedSongs = songs.filter(s => s?.status === 'played');

  return (
    <div className="dj-dashboard">
      <div className="dashboard-header">
        <div className="header-left">
          <Music size={32} />
          <h1>DJ Dashboard</h1>
        </div>
        <div className="header-actions">
          <Button
            data-testid="close-room-btn"
            onClick={closeRoom}
            className="close-room-btn"
          >
            <LogOut size={18} />
            Close Room
          </Button>
        </div>
      </div>

      <div className="room-info-card">
        <div className="pin-section">
          <h2>Room PIN</h2>
          <div data-testid="room-pin" className="pin-display">{room.pin}</div>
          <p className="pin-instruction">Share this PIN with party goers</p>
        </div>
        {qrCodeUrl && (
          <div className="qr-section">
            <h2>QR Code</h2>
            <img data-testid="qr-code" src={qrCodeUrl} alt="Room QR Code" className="qr-code" />
          </div>
        )}
      </div>

      <div className="songs-section">
        <div className="song-queue">
          <h2 data-testid="pending-songs-header" className="queue-title">Pending Requests ({pendingSongs.length})</h2>
          <div className="song-list">
            {pendingSongs.map(song => (
              <Card key={song.id} className="song-card pending">
                <img src={song.thumbnail} alt={song.title} className="song-thumbnail" />
                <div className="song-info">
                  <h3 className="song-title">{song.title}</h3>
                  <p className="song-submitter">By: {song.submitter_name}</p>
                  <div className="song-votes">
                    <ThumbsUp size={16} />
                    <span>{song.votes} votes</span>
                  </div>
                </div>
                <div className="song-actions">
                  <Button
                    data-testid={`approve-song-${song.id}`}
                    onClick={() => updateSongStatus(song.id, 'approved')}
                    className="action-btn approve-btn"
                  >
                    <Check size={18} />
                  </Button>
                  <Button
                    data-testid={`reject-song-${song.id}`}
                    onClick={() => updateSongStatus(song.id, 'rejected')}
                    className="action-btn reject-btn"
                  >
                    <X size={18} />
                  </Button>
                </div>
              </Card>
            ))}
            {pendingSongs.length === 0 && (
              <p className="empty-message">No pending requests</p>
            )}
          </div>
        </div>

        <div className="song-queue">
          <h2 className="queue-title">Approved Queue ({approvedSongs.length})</h2>
          <div className="song-list">
            {approvedSongs.map(song => (
              <Card key={song.id} className="song-card approved">
                <img src={song.thumbnail} alt={song.title} className="song-thumbnail" />
                <div className="song-info">
                  <h3 className="song-title">{song.title}</h3>
                  <p className="song-submitter">By: {song.submitter_name}</p>
                  <div className="song-votes">
                    <ThumbsUp size={16} />
                    <span>{song.votes} votes</span>
                  </div>
                </div>
                <div className="song-actions">
                  <Button
                    data-testid={`play-song-${song.id}`}
                    onClick={() => updateSongStatus(song.id, 'played')}
                    className="action-btn play-btn"
                  >
                    <Play size={18} />
                  </Button>
                  <a
                    href={song.youtube_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="youtube-link"
                  >
                    Open
                  </a>
                </div>
              </Card>
            ))}
            {approvedSongs.length === 0 && (
              <p className="empty-message">No approved songs</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DJDashboard;