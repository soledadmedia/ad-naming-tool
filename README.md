# Ad Naming Tool - RestoMods

Automatically rename video ad files using consistent naming conventions based on content analysis.

## Features

- 🔐 **Google Sign-in** - Secure OAuth authentication
- 📁 **Drive Integration** - Browse and select folders from Google Drive
- 🎬 **Video Analysis** - Extract duration and transcribe audio using OpenAI Whisper
- 🏷️ **Smart Naming** - Automatically detect multiplier mentions and TikTok safety
- ✏️ **Editable Suggestions** - Review and modify suggested names before applying
- 📝 **Batch Rename** - Rename all files at once via Drive API

## Naming Convention

```
[MULTIPLIER][SEQUENCE].[TTS].[CREATOR].[DESCRIPTION].[LENGTH]sec.mp4
```

### Multiplier Codes
| Code | Meaning |
|------|---------|
| 5000 | 5X Entries |
| 4000 | 4X Entries |
| 3000 | 3X Entries |
| 2000 | 2X Entries |
| 1000 | 1X or No Mention (evergreen) |
| 0001 | END OF SWEEPS/LASTCHANCE |

### Creator Codes
| Code | Creator |
|------|---------|
| 0 | Chris Carter [FORGED] or Chris Hedgecock [RM] |
| 6 | LAZ |
| 9 | Lindsay or Alex |
| 5 | Outside social media creator |

### TTS Label
- **TTS** is included if the ad is TikTok-safe (no payment mentions like "$12.95", "every dollar equals entries")
- Omitted if not safe for TikTok

## Setup

### 1. Clone the Repository

```bash
git clone https://github.com/soledadmedia/ad-naming-tool.git
cd ad-naming-tool
npm install
```

### 2. Set Up Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Google Drive API**:
   - Go to "APIs & Services" > "Library"
   - Search for "Google Drive API" and enable it
4. Create OAuth credentials:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth client ID"
   - Choose "Web application"
   - Add authorized redirect URIs:
     - For local: `http://localhost:3000/api/auth/callback/google`
     - For production: `https://your-vercel-url.vercel.app/api/auth/callback/google`
5. Copy the Client ID and Client Secret

### 3. Get OpenAI API Key

1. Go to [OpenAI Platform](https://platform.openai.com/)
2. Navigate to API Keys section
3. Create a new API key

### 4. Configure Environment Variables

Create a `.env.local` file:

```bash
cp .env.example .env.local
```

Edit `.env.local` with your credentials:

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-random-secret
OPENAI_API_KEY=sk-your-openai-key
```

Generate a random secret:
```bash
openssl rand -base64 32
```

### 5. Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Deployment to Vercel

### Option 1: Deploy via Vercel Dashboard

1. Push your code to GitHub
2. Go to [Vercel](https://vercel.com)
3. Import your repository
4. Add environment variables in Vercel dashboard:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `NEXTAUTH_URL` (your Vercel URL)
   - `NEXTAUTH_SECRET`
   - `OPENAI_API_KEY`
5. Deploy!

### Option 2: Deploy via CLI

```bash
npm i -g vercel
vercel
```

### Important: Update Google OAuth Redirect URI

After deploying, add your Vercel URL to Google OAuth authorized redirect URIs:
```
https://your-app.vercel.app/api/auth/callback/google
```

## Usage

1. Click "Sign in with Google"
2. Grant access to Google Drive
3. Click "Select Folder" and navigate to your video folder
4. Select a creator from the dropdown
5. Click "Process Videos"
6. Review suggested names and edit if needed
7. Click "Rename All Files" to apply changes

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Authentication**: NextAuth.js with Google OAuth
- **APIs**: Google Drive API, OpenAI Whisper
- **Styling**: Tailwind CSS
- **Deployment**: Vercel

## Requirements

- Node.js 18+
- FFmpeg installed (for video/audio processing)
- Google Cloud project with Drive API enabled
- OpenAI API key with Whisper access

## Note on FFmpeg

For local development, you need FFmpeg installed:
- **macOS**: `brew install ffmpeg`
- **Ubuntu**: `sudo apt install ffmpeg`
- **Windows**: Download from [ffmpeg.org](https://ffmpeg.org/download.html)

On Vercel, FFmpeg is pre-installed in the serverless runtime.

## License

MIT
