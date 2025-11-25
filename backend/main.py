from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect
from motor.motor_asyncio import AsyncIOMotorClient
from starlette.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from dotenv import load_dotenv
import os
from typing import List, Dict
import json
import logging
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]
api_router = APIRouter(prefix="/api")

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    client.close()
    print("Database client closed")

app = FastAPI(lifespan=lifespan)

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

@api_router.get("/")
def test():
    return "test"

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
