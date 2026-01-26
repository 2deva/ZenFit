# 🧘🏃🏻 ZenFit

> **"Stop just planning your fitness goals. Start training with a personalized AI-powered coach that helps you stay consistent and truly achieve them."**

![ZenFit Banner](https://img.shields.io/badge/Status-Checkpoint_2_Complete-success?style=for-the-badge) ![Tech Stack](https://img.shields.io/badge/Stack-React_|_Gemini_2.0_|_Supabase-blue?style=for-the-badge)

**ZenFit** is the world's first **Psychology-First AI Fitness Agent**. Built with **Google Gemini 2.5 Flash** and **Gemini Live**, it transforms the standard "text-in, text-out" chatbot experience into a proactive, multimodal coaching session.

---

**"ZenFit: Help people actually achieve their goals—not just make them."**

ZenFit directly addresses the #1 reason resolutions fail: **The gap between Planning and Doing.**
*   **Action-Parallel Protocol**: While other apps ask 20 questions, ZenFit starts your workout *immediately*.
*   **Psychology Adherence**: It detects "Burnout" vs "Laziness" and pivots your plan to keep the streak alive.
*   **Real-time Accountability**: It counts your reps for you, making it impossible to "fake" a session.

---

## 🧠 The Difference: Agentic vs. Passive

Most AI fitness apps are **Passive**:
*   *You:* "I want to workout."
*   *App:* "Here is a list of pushups." (Text)

ZenFit is **Agentic**:
*   *You:* "I want to workout."
*   *ZenFit:* "I know you're stressed from work today. Let's do a 15-minute high-intensity release. I've set the timer. **Ready to start your first set?**" (Voice + UI + State Tracking)

ZenFit doesn't just *retrieve* information; it **executes** guidance.

---

## ✨ Key Capabilities

### 1. 🗣️ Real-Time "Live" Guidance
ZenFit solves the #1 problem with fitness apps: **Touching your phone with sweaty hands and getting distracted.**

*   **Hands-Free Coaching**: Using **Gemini Live**, ZenFit speaks to you in real-time.
*   **The `GuidanceExecutor` Engine**: Custom state machine drives the session. It doesn't just read text; it tracks:
    *   **Rep Counting**: "That's 5... 6... keep going!"
    *   **Pacing**: Adapts the counting speed to *your* actual movement speed.
    *   **Recovery**: Automatically triggers rest timers and breathing cues between sets.

### 2. 🎨 Generative UI
**"Text is for reasoning. UI is for compression."**

ZenFit has no static dashboards. Every interface element is **hallucinated** (generated) by the AI only when the context demands it:
*   **Need a plan?** → ZenFit renders a `WorkoutBuilder`.
*   **Ready to move?** → ZenFit swaps to a `Timer` or `WorkoutList`.
*   **Asking about progress?** → ZenFit draws a `HabitHeatmap` or `Chart`.

### 3. 🧩 Psychology-First Architecture
ZenFit builds a `UserContext` that tracks more than just steps. It follows a **"Three Pillars"** philosophy:
*   **Physical**: Movement, strength, and flexibility.
*   **Mental**: Stress management and emotional regulation.
*   **Recovery**: Sleep hygiene and active rest.

**Adaptive Logic**:
*   **Stressed?** → Pivots to Pillar 2 (Mindfulness/Breathing).
*   **Hesitant?** → Pivots to Pillar 1 (Minimum Viable Workout).
*   **Tired?** → Pivots to Pillar 3 (Recovery/Stretching).

---

## 🛠️ Technical Deep Dive

### 🏗️ Architecture

```mermaid
graph TD
    User((User)) <-->|Voice/Text| Gemini[Gemini 2.0 Flash]
    Gemini <-->|Function Calls| Tools[Tool Manager]
    
    subgraph "The Agentic Loop"
        Tools -->|Render| GenUI[Generative UI System]
        Tools -->|Execute| Guidance[GuidanceExecutor Service]
        Guidance -->|Cues| TTS[Text-to-Speech]
        Guidance -->|State| Context[UserContext Service]
    end
    
    subgraph "Data Layer (Offline-First)"
        Context <--> Sync[SyncService (Queue)]
        Sync <--> Supabase[(Supabase DB)]
        Sync <--> Local[Local Storage]
    end
```

### ⚡ The "Offline-First" Sync Engine
Fitness happens everywhere—often where Wi-Fi is weak. Zenfit's `SyncService` ensures continuity:
1.  **Optimistic UI**: All actions (logging sets, chatting) happen instantly locally.
2.  **Operation Queue**: Actions are serialized into a persisting queue (Redux-style).
3.  **Auto-Replay**: When connectivity returns, the queue flushes to Supabase automatically.

### 🔒 Security & Privacy
*   **Auth**: Firebase Authentication (Google Sign-In).
*   **Data**: Row Level Security (RLS) policies on Supabase ensure you only access your own data.
*   **AI**: No personal data is used for model training; context is injected ephemerally.

---

## 🚀 Getting Started

### Prerequisites
*   Node.js 18+
*   Google Cloud Project (Gemini API)
*   Supabase Project
*   Firebase Project

### Installation

1.  **Environment Setup**
    Create `.env.local`:
    ```env
    gemini_api_key=your_key_here
    VITE_SUPABASE_URL=your_url
    VITE_SUPABASE_ANON_KEY=your_key
    VITE_FIREBASE_API_KEY=your_firebase_key
    ...
    ```

2.  **Run Development Server**
    ```bash
    npm run dev
    ```

### Deployment (Vercel)
Zenfit is "Vercel-Ready".
1.  Import repo to Vercel.
2.  Add environment variables.
3.  Deploy.

