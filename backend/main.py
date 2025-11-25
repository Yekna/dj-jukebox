from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from motor.motor_asyncio import AsyncIOMotorClient
from starlette.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from pydantic import BaseModel, EmailStr, ConfigDict, Field
import bcrypt
import jwt
import os
from typing import List, Dict
import json
import logging
from pathlib import Path
import uuid
from datetime import datetime, timezone, timedelta

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]
api_router = APIRouter(prefix="/api")

JWT_SECRET = os.environ.get('JWT_SECRET', 'jwt-secret')
JWT_ALGORITHM = 'HS256'
JWT_EXPIRATION_HOURS = 24

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    client.close()
    print("Database client closed")

app = FastAPI(lifespan=lifespan)

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

@api_router.get("/")
def test():
    return "test"

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
