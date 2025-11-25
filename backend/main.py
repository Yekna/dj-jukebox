from fastapi import FastAPI, APIRouter
import os
from motor.motor_asyncio import AsyncIOMotorClient

app = FastAPI()
api_router = APIRouter(prefix="/api")
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

@api_router.get("/")
def test():
    print(os.environ['DB_NAME'])
    return "test"

app.include_router(api_router)