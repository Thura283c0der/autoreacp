# VoxCPM Voice Studio

A beautiful dark-themed static web app for **AI Text-to-Speech** and **Voice Cloning**, powered by the official [openbmb/VoxCPM-Demo](https://huggingface.co/spaces/openbmb/VoxCPM-Demo) space on Hugging Face. No backend server needed — everything runs in the browser and connects to the demo space through its public Gradio API.

![Theme](https://img.shields.io/badge/theme-dark%20navy%20%2B%20cyan-3fd3f5) ![Deployment](https://img.shields.io/badge/deploy-GitHub%20Pages-181717) ![License](https://img.shields.io/badge/license-MIT-green)

## Features

| Feature | Description |
| --- | --- |
| **Text-to-Speech** | Enter text, describe the voice style (e.g. "A warm male voice speaking slowly"), and generate speech |
| **Voice Cloning** | Upload a short audio clip (MP3/WAV/OGG, up to ~50s), enter text, and clone that voice |
| **Preset voice styles** | One-click style chips: warm male, soft female, dramatic narrator, energetic, soothing, childlike |
| **Audio player** | Built-in player with animated waveform visualization |
| **Download** | One-click download of the generated audio (WebM/48kHz) |
| **Advanced options** | Creativity (CFG) slider 1.0–3.0, text normalization, reference denoise |
| **Myanmar labels** | Key labels include Burmese (မြန်မာ) translations |
| **Queue awareness** | Live queue position, progress percentage, and heart-beat status from the demo space |
| **Responsive** | Works on desktop, tablet, and mobile |

## How it works

1. The app connects directly from the browser to `https://openbmb-voxcpm-demo.hf.space/gradio_api`.
2. For voice cloning, the reference audio is uploaded via the Gradio `/upload` multipart endpoint, which returns a server file path.
3. A `POST /generate` request is sent with the text, style description, reference audio (optional), and options.
4. The response is streamed via Server-Sent Events (`/generate/stream/<event_id>`), providing queue status and progress.
5. The returned audio `FileData` URL is played in an `<audio>` player and offered as a download link.

Because it is a pure static site, you can host it anywhere: GitHub Pages, Netlify, Vercel, Cloudflare Pages, or just open `index.html` locally.

## Deploy on GitHub Pages (3 steps)

1. Push the contents of this folder (including the `css/` and `js/` folders) to a GitHub repository.
2. Go to **Settings → Pages**, set **Source** to `main` branch and `/ (root)` folder, then save.
3. Your site is live at `https://<your-username>.github.io/<repo-name>/`.

No build step is required.

## Local testing

Simply serve the folder with any static server, e.g.:

```bash
# Python
python3 -m http.server 8000

# or Node
npx serve .
```

Then open `http://localhost:8000` in your browser.

## Notes & limitations

- The VoxCPM demo space works best with **English and Chinese** text. Myanmar text output quality is not guaranteed by the underlying model.
- The public demo space runs on shared hardware and may be **asleep (cold start)** — the app automatically retries and shows a "waking up" status. If it is heavily loaded, generation takes longer (30s–3min).
- Reference audio for cloning should be a clean clip of the target voice, up to ~50 seconds. Enable "Denoise reference audio" for noisy samples.
- This app is a client for the official open-source demo. Heavy usage is subject to Hugging Face's fair-use policy; for production use, run your own VoxCPM instance or use a private Space.

## Credits

- **Model**: [VoxCPM](https://github.com/OpenBMB/VoxCPM) by OpenBMB (Apache-2.0)
- **Demo space**: [openbmb/VoxCPM-Demo](https://huggingface.co/spaces/openbmb/VoxCPM-Demo) on Hugging Face
- **Font**: [Padauk](https://fonts.google.com/specimen/Padauk) for Myanmar text, Inter for UI

## License

MIT — feel free to use, modify, and deploy.
