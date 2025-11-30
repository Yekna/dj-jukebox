import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { API } from "@/App";
import type { Room, Song } from "@/App"
import QRCode from 'qrcode'
import { Badge, Music, Search, ThumbsUp } from "lucide-react";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Card } from "./ui/card";


const PartyGoerRoom = () => {
    const { pin } = useParams();
    const [room, setRoom] = useState<null | Room>(null);
    const [songs, setSongs] = useState<Array<Song>>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<Array<Song>>([]);
    const [submitterName, setSubmitterName] = useState("");
    const [isNamed, setIsNamed] = useState(false);
    const [sessionId, setSessionId] = useState("");
    const [loading, setLoading] = useState(false);
    const [qrCodeUrl, setQrCodeUrl] = useState("");
    const wsRef = useRef<null | WebSocket>(null);
    const navigate = useNavigate();

    useEffect(() => {
        let sid = localStorage.getItem(`session_${pin}`);
        if (!sid) {
            sid = `session_${Date.now()}_${Math.random()}`;
            localStorage.setItem(`session_${pin}`, sid);
        }
        setSessionId(sid);

        loadRoom();
    }, [pin]);

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

    const loadRoom = async () => {
        try {
            const data = await fetch(`${API}/rooms/${pin}`).then(res => res.json())
            setRoom(data);
        } catch (error) {
            toast.error("Room not found");
        }
    };

    const connectWebSocket = () => {
        const wsUrl = `${API.replace('https', 'wss').replace('http', 'ws')}/ws/${pin}`;
        wsRef.current = new WebSocket(wsUrl);

        wsRef.current.onopen = () => {
            wsRef.current?.send(JSON.stringify({
                type: 'user_joined',
                user: submitterName || 'Guest'
            }));
        };

        wsRef.current.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (data.type === 'song_requested' || data.type === 'song_voted' || data.type === 'song_status_changed') {
                loadSongs();
            } else if (data.type === 'room_closed') {
                toast.error("Room has been closed by the DJ");
                navigate('/')
            }
        };
    };

    const loadSongs = async () => {
        try {
            const data = await fetch(`${API}/rooms/${pin}/songs`).then(res => res.json())
            if (!data?.songs) {
                throw new Error("No songs found. Probably a problem on our part")
            }
            setSongs(data.songs);
        } catch (error) {
            console.error("Failed to load songs", error);
        }
    };

    const generateQRCode = async () => {
        const roomUrl = `${window.location.origin}/room/${pin}`;
        try {
            const qrDataUrl = await QRCode.toDataURL(roomUrl, {
                width: 200,
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

    const searchSongs = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!searchQuery.trim()) return;

        setLoading(true);
        try {
            const data = await fetch(`${API}/songs/search?q=${searchQuery}&max_results=${10}`).then(res => res.json())
            setSearchResults(data.results);
        } catch (error) {
            toast.error("Search failed");
        } finally {
            setLoading(false);
        }
    };

    const requestSong = async (song: Song) => {
        if (isNamed && !submitterName.trim()) {
            toast.error("Please enter your name");
            return;
        }

        try {
            await fetch(`${API}/rooms/${pin}/songs`, {
                method: "POST", body: JSON.stringify({
                    youtube_video_id: song.video_id,
                    title: song.title,
                    thumbnail: song.thumbnail,
                    youtube_url: song.youtube_url,
                    submitter_name: isNamed ? submitterName : "Guest",
                    submitter_type: isNamed ? "named" : "guest"
                }), headers: { 'Content-Type': 'application/json' }
            })
            toast.success("Song requested!");

            setSearchResults([]);
            setSearchQuery("");
        } catch (error) {
            toast.error("Failed to request song");
        }
    };

    const voteSong = async (songId: string) => {
        try {
            await fetch(`${API}/songs/${songId}/vote`, {method: "POST", body: JSON.stringify({session_id: sessionId}), headers: {"Content-Type": "application/json"}})
            toast.success("Vote added!");
        } catch (error) {
            toast.error("Failed to vote");
        }
    };

    // todo: find a way to redirect if for sure the room doesn't exist
    if (!room) {
        return <div className="loading-screen">Loading room...</div>;
    }

    const visibleSongs = songs.filter(s => s.status !== 'rejected');

    return (
        <div className="partygoer-room">
            <div className="room-header">
                <div className="header-content">
                    <Music size={28} />
                    <div>
                        <h1>Room {pin}</h1>
                        <p className="dj-name">DJ: {room.dj_email}</p>
                    </div>
                </div>
                {qrCodeUrl && (
                    <div className="qr-mini">
                        <img src={qrCodeUrl} alt="Room QR" />
                    </div>
                )}
            </div>

            <div className="name-section">
                <div className="name-toggle">
                    <label className="switch">
                        <input
                            data-testid="name-toggle"
                            type="checkbox"
                            checked={isNamed}
                            onChange={(e) => setIsNamed(e.target.checked)}
                        />
                        <span className="slider"></span>
                    </label>
                    <span>Add my name for shout-outs</span>
                </div>
                {isNamed && (
                    <Input
                        data-testid="submitter-name-input"
                        type="text"
                        placeholder="Your name"
                        value={submitterName}
                        onChange={(e) => setSubmitterName(e.target.value)}
                        className="name-input"
                    />
                )}
            </div>

            <div className="search-section">
                <h2 className="section-title">Search Songs</h2>
                <form onSubmit={searchSongs} className="search-form">
                    <div className="search-input-wrapper">
                        <Search className="search-icon" size={20} />
                        <Input
                            data-testid="song-search-input"
                            type="text"
                            placeholder="Search for a song..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="search-input"
                        />
                    </div>
                    <Button
                        data-testid="search-btn"
                        type="submit"
                        disabled={loading}
                        className="search-btn"
                    >
                        {loading ? "Searching..." : "Search"}
                    </Button>
                </form>

                {searchResults.length > 0 && (
                    <div className="search-results">
                        {searchResults.map((song, idx) => (
                            <Card key={idx} className="result-card">
                                <img src={song.thumbnail} alt={song.title} className="result-thumbnail" />
                                <div className="result-info">
                                    <h3 className="result-title">{song.title}</h3>
                                </div>
                                <Button
                                    data-testid={`request-song-${idx}`}
                                    onClick={() => requestSong(song)}
                                    className="request-btn"
                                >
                                    Request
                                </Button>
                            </Card>
                        ))}
                    </div>
                )}
            </div>

            <div className="queue-section">
                <h2 className="section-title">Song Queue ({visibleSongs.length})</h2>
                <div className="queue-list">
                    {visibleSongs.map(song => (
                        <Card key={song.id} className={`queue-card ${song.status}`}>
                            <img src={song.thumbnail} alt={song.title} className="queue-thumbnail" />
                            <div className="queue-info">
                                <h3 className="queue-title-text">{song.title}</h3>
                                <p className="queue-submitter">By: {song.submitter_name}</p>
                                <div className="queue-meta">
                                    <Badge className={`status-badge ${song.status}`}>{song.status}</Badge>
                                    <button
                                        data-testid={`vote-song-${song.id}`}
                                        onClick={() => voteSong(song.id)}
                                        className="vote-btn"
                                        disabled={song.status !== 'pending' && song.status !== 'approved'}
                                    >
                                        <ThumbsUp size={16} />
                                        <span>{song.votes}</span>
                                    </button>
                                </div>
                            </div>
                            <a
                                href={song.youtube_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="youtube-link-small"
                            >
                                View
                            </a>
                        </Card>
                    ))}
                    {visibleSongs.length === 0 && (
                        <p className="empty-message">No songs in queue yet. Be the first!</p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default PartyGoerRoom