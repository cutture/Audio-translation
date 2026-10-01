from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI()  # reads OPENAI_API_KEY

with open("Recording.mp3", "rb") as audio_file:
    output = client.audio.translations.create(model="whisper-1", file=audio_file)
print(output.text)
