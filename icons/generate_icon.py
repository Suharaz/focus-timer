"""
Generate Focus Timer Chrome Extension Icon using Gemini API
Anime/Kawaii style with purple gradient theme
"""

from google import genai
from google.genai import types
import os
import sys

# Add skills path for env resolution
sys.path.insert(0, os.path.join(os.path.expanduser('~'), '.claude', 'skills', 'ai-multimodal'))

def generate_icon():
    # Initialize client
    api_key = os.getenv('GEMINI_API_KEY')
    if not api_key:
        # Try loading from .env
        from dotenv import load_dotenv
        load_dotenv(os.path.join(os.path.expanduser('~'), '.claude', 'skills', 'ai-multimodal', '.env'))
        api_key = os.getenv('GEMINI_API_KEY')

    if not api_key:
        print("Error: GEMINI_API_KEY not found")
        return False

    client = genai.Client(api_key=api_key)

    # Detailed prompt for anime-style focus timer icon
    prompt = """Create a cute anime/kawaii style icon for a Focus Timer Chrome extension.

Design specifications:
- A chibi-style anime clock character with large expressive eyes (kawaii style)
- The character should have a round clock face as its body
- Clock hands showing a focused time (like 25 minutes for Pomodoro)
- Soft gradient background from purple (#8b5cf6) to violet (#a78bfa)
- The character should have a determined/focused expression
- Small anime-style blush marks on cheeks
- Simple, clean lines that work at small sizes
- NO text or numbers on the clock face to keep it simple
- Gentle glow effect around the character
- Style: Japanese kawaii, chibi proportions, simple and iconic
- The design should be recognizable as both a timer and a cute mascot
- Colors: Primary purple (#8b5cf6), accent violet (#a78bfa), white highlights
- Clean white or light purple outline for visibility on dark backgrounds

IMPORTANT:
- Keep the design SIMPLE and CLEAN for icon use (16px-128px)
- NO complex details that would be lost at small sizes
- DO NOT include any text or watermarks
- Center the character in a square composition
- Use flat colors with minimal gradients for better scaling
"""

    print("Generating icon with Gemini...")

    try:
        response = client.models.generate_content(
            model='gemini-3-pro-image-preview',
            contents=prompt,
            config=types.GenerateContentConfig(
                response_modalities=['IMAGE'],
                image_config=types.ImageConfig(
                    aspect_ratio='1:1'
                )
            )
        )

        # Extract and save image
        for part in response.candidates[0].content.parts:
            if part.inline_data:
                output_path = os.path.join(
                    os.path.dirname(os.path.abspath(__file__)),
                    'icon-generated.png'
                )
                with open(output_path, 'wb') as f:
                    f.write(part.inline_data.data)
                print(f"Icon saved to: {output_path}")
                return True

        print("No image data in response")
        return False

    except Exception as e:
        print(f"Error generating icon: {e}")
        return False

if __name__ == '__main__':
    success = generate_icon()
    sys.exit(0 if success else 1)
