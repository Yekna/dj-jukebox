from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from motor.motor_asyncio import AsyncIOMotorClient
from starlette.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from pydantic import BaseModel, EmailStr, ConfigDict, Field
import bcrypt
import jwt
import os
from typing import List, Dict, Optional
import json
import logging
from pathlib import Path
import uuid
from datetime import datetime, timezone, timedelta
import random

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
YOUTUBE_API_KEY = os.environ.get('YOUTUBE_API_KEY', 'your-youtube-api-key')
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]
api_router = APIRouter(prefix="/api")
security = HTTPBearer()

JWT_SECRET = os.environ.get('JWT_SECRET', 'jwt-secret')
JWT_ALGORITHM = 'HS256'
JWT_EXPIRATION_HOURS = 24

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    client.close()
    print("Database client closed")

app = FastAPI(lifespan=lifespan)

class VoteRequest(BaseModel):
    session_id: str

class StatusUpdate(BaseModel):
    status: str

class SongRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    room_id: str
    youtube_video_id: str
    title: str
    thumbnail: str
    youtube_url: str
    submitter_name: Optional[str] = "Guest"
    submitter_type: str = "guest"
    votes: int = 0
    voted_by: List[str] = Field(default_factory=list) 
    status: str = "pending"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class SongRequestCreate(BaseModel):
    youtube_video_id: str
    title: str
    thumbnail: str
    youtube_url: str
    submitter_name: Optional[str] = "Guest"
    submitter_type: str = "guest"

class Room(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    pin: str
    dj_id: str
    dj_email: str
    active: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    email: EmailStr
    password_hash: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class UserRegister(BaseModel):
    email: EmailStr
    password: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, room_pin: str):
        await websocket.accept()
        if room_pin not in self.active_connections:
            self.active_connections[room_pin] = []
        self.active_connections[room_pin].append(websocket)

    def disconnect(self, websocket: WebSocket, room_pin: str):
        if room_pin in self.active_connections:
            self.active_connections[room_pin].remove(websocket)
            if not self.active_connections[room_pin]:
                del self.active_connections[room_pin]

    async def broadcast(self, room_pin: str, message: dict):
        if room_pin in self.active_connections:
            for connection in self.active_connections[room_pin]:
                try:
                    await connection.send_json(message)
                except:
                    pass

manager = ConnectionManager()

def generate_room_pin() -> str:
    return ''.join([str(random.randint(0, 9)) for _ in range(4)])

def create_jwt_token(user_id: str, email: str) -> str:
    expiration = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS)
    payload = {
        'user_id': user_id,
        'email': email,
        'exp': expiration
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))

def verify_jwt_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    payload = verify_jwt_token(token)
    user = await db.users.find_one({"id": payload['user_id']}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return User(**user)

def get_youtube_service():
    return build('youtube', 'v3', developerKey=YOUTUBE_API_KEY, cache_discovery=False)

@api_router.post("/auth/register")
async def register(user_data: UserRegister):
    existing_user = await db.users.find_one({"email": user_data.email}, {"_id": 0})

    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    user = User(
        email=user_data.email,
        password_hash=hash_password(user_data.password)
    )
    
    doc = user.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.users.insert_one(doc)
    
    token = create_jwt_token(user.id, user.email)
    
    return {
        "token": token,
        "user": {
            "id": user.id,
            "email": user.email
        }
    }

@api_router.post("/auth/login")
async def login(user_data: UserLogin):
    user_doc = await db.users.find_one({"email": user_data.email}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    if not verify_password(user_data.password, user_doc['password_hash']):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    token = create_jwt_token(user_doc['id'], user_doc['email'])
    
    return {
        "token": token,
        "user": {
            "id": user_doc['id'],
            "email": user_doc['email']
        }
    }

@api_router.post("/songs/{song_id}/vote")
async def vote_song(song_id: str, vote_data: VoteRequest):
    song = await db.song_requests.find_one({"id": song_id}, {"_id": 0})
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    
    votes = song.get("votes")
    voted_by = song.get('voted_by', [])

    if vote_data.session_id in voted_by:
        await db.song_requests.update_one(
            {"id": song_id},
            {
                "$set": { "votes": votes - 1 },
                "$pull": { "voted_by": vote_data.session_id }
            }
        )
    else:
        await db.song_requests.update_one(
            {"id": song_id},
            {
                "$inc": {"votes": votes + 1},
                "$push": {"voted_by": vote_data.session_id}
            }
        )
    
    updated_song = await db.song_requests.find_one({"id": song_id}, {"_id": 0})
    
    room = await db.rooms.find_one({"id": song['room_id']}, {"_id": 0})

    if room:
        await manager.broadcast(room['pin'], {
            "type": "song_voted",
            "song": updated_song
        })
    
    return updated_song

@api_router.patch("/songs/{song_id}/status")
async def update_song_status(
    song_id: str,
    status_data: StatusUpdate,
    current_user: User = Depends(get_current_user)
):
    song = await db.song_requests.find_one({"id": song_id}, {"_id": 0})
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    
    room = await db.rooms.find_one({"id": song['room_id']}, {"_id": 0})
    if not room or room['dj_id'] != current_user.id:
        raise HTTPException(status_code=403, detail="Only the DJ can update song status")
    
    await db.song_requests.update_one(
        {"id": song_id},
        {"$set": {"status": status_data.status}}
    )
    
    updated_song = await db.song_requests.find_one({"id": song_id}, {"_id": 0})
    
    await manager.broadcast(room['pin'], {
        "type": "song_status_changed",
        "song": updated_song
    })
    
    return updated_song

@api_router.get("/rooms/{pin}/songs")
async def get_room_songs(pin: str):
    room = await db.rooms.find_one({"pin": pin, "active": True}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Room not found or closed")
    
    songs = await db.song_requests.find(
        {"room_id": room['id']},
        {"_id": 0}
    ).sort("created_at", 1).to_list(1000)
    
    return {"songs": songs}

@api_router.post("/rooms/{pin}/songs")
async def request_song(pin: str, song_data: SongRequestCreate):
    room = await db.rooms.find_one({"pin": pin, "active": True}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Room not found or closed")
    
    song_request = SongRequest(
        room_id=room['id'],
        youtube_video_id=song_data.youtube_video_id,
        title=song_data.title,
        thumbnail=song_data.thumbnail,
        youtube_url=song_data.youtube_url,
        submitter_name=song_data.submitter_name,
        submitter_type=song_data.submitter_type
    )
    
    doc = song_request.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.song_requests.insert_one(doc)

    await db.song_requests.find_one({"id": doc['id']}, {"_id": 0})

    await manager.broadcast(pin, {
        "type": "song_requested",
        "song": song_request.model_dump()
    })
    
    return song_request

@api_router.get("/songs/search")
async def search_songs(q: str, max_results: int = 10):
    try:
        youtube = get_youtube_service()
        request = youtube.search().list(
            part="snippet",
            q=q,
            type="video",
            maxResults=max_results,
            videoCategoryId="10"
        )
        response = request.execute()
        
        results = []
        for item in response.get("items", []):
            if item["id"]["kind"] == 'youtube#channel':
                request2 = youtube.search().list(
                    channelId=item["id"]["channelId"],
                    type="video",
                    part="snippet",
                    maxResults=max_results,
                    videoCategoryId="10"
                )
                res = request2.execute()
            else:
                video_id = item["id"]["videoId"]
                results.append({
                    "video_id": video_id,
                    "title": item["snippet"]["title"],
                    "thumbnail": item["snippet"]["thumbnails"]["high"]["url"],
                    "youtube_url": f"https://www.youtube.com/watch?v={video_id}"
                })

        return {"results": results}
    except HttpError as e:
        if "quotaExceeded" in str(e):
            raise HTTPException(status_code=429, detail="YouTube API quota exceeded")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")

@api_router.post("/rooms/{pin}/close")
async def close_room(pin: str, current_user: User = Depends(get_current_user)):
    room = await db.rooms.find_one({"pin": pin, "active": True}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    
    if room['dj_id'] != current_user.id:
        raise HTTPException(status_code=403, detail="Only the DJ can close the room")
    
    await db.rooms.update_one(
        {"pin": pin},
        {"$set": {"active": False}}
    )
    
    await manager.broadcast(pin, {
        "type": "room_closed",
        "message": "DJ has closed the room"
    })
    
    return {"message": "Room closed successfully"}

@api_router.get("/rooms/{pin}")
async def get_room(pin: str):
    room = await db.rooms.find_one({"pin": pin, "active": True}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Room not found or closed")
    return Room(**room)

@api_router.post("/rooms/create")
async def create_room(current_user: User = Depends(get_current_user)):
    existing_room = await db.rooms.find_one(
        {"dj_id": current_user.id, "active": True},
        {"_id": 0}
    )
    if existing_room:
        return Room(**existing_room)
    
    pin = generate_room_pin()
    while await db.rooms.find_one({"pin": pin, "active": True}):
        pin = generate_room_pin()
    
    room = Room(
        pin=pin,
        dj_id=current_user.id,
        dj_email=current_user.email
    )
    
    doc = room.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.rooms.insert_one(doc)
    
    return room

app.include_router(api_router)

@app.websocket("/api/ws/{room_pin}")
async def websocket_endpoint(websocket: WebSocket, room_pin: str):
    await manager.connect(websocket, room_pin)
    try:
        await websocket.send_json({
            "type": "connected",
            "room_pin": room_pin
        })
        
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            if message.get('type') == 'user_joined':
                await manager.broadcast(room_pin, {
                    "type": "user_joined",
                    "user": message.get('user', 'Guest')
                })
    
    except WebSocketDisconnect:
        manager.disconnect(websocket, room_pin)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)
