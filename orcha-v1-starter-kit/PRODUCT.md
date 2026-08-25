# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: React + Vite + TypeScript for the first prototype, with a portable UI boundary for later Next.js integration.

## Users

Technically curious founders, operators, and makers who want to turn one outcome into a working software product without managing multi-agent infrastructure.

## Product Purpose

Orcha creates a persistent AI company around a user's goal. The company plans, delegates, builds, tests, learns, and reports progress through a consumer control room.

## Positioning

The main consumer object is a Company, not an agent. Live HQ makes real orchestration legible, while Evolution shows measured variants competing and being promoted or rolled back.

## Operating Context

Users open Orcha to see what happened while away, what the company is doing now, what shipped, and what needs attention. The always-on company runtime lives in a cloud VM; the UI is the cockpit.

## Consumer entry

The product starts on chat. Trying to send opens signup. After signup, the user starts a business. Then the held message sends. The sidebar lists companies and their chats. Settings is a full page in the ChatGPT/Cursor pattern: General, Chat, Personalization, Companies, Data controls, Legal & Privacy, and Account. Preferences persist on this device and change chat, motion, and replies. Signing out locks the session: the AI will not reply until the saved email is signed in again. Companies stay on the device and return after sign-in. Delete account removes associated data on the device.

## Pricing

Orcha Pro is **$20 per month**. Target host cost is about **$10** for the VM. About **$5** is reserved for frontier models such as GPT-5.6, and only for the hardest questions — and only when no free model ranks at or above that level. The catalog refreshes from OpenRouter about every 15 minutes. While Ox Alpha is free and listed as a top reasoning model, it handles both general and advanced work. Video creation is outsourced: the reasoning model writes the brief; it does not emit video files. Otherwise chat uses Google AI Studio Gemini 2.5 Flash until a user hits 50,000 premium tokens that month, then Groq Llama 3.3 70B (or Gemini with a truncated context) with a 5-second throttle so free RPM limits hold. This prototype does not collect payment.

## Capabilities and Constraints

V1 focuses on autonomous software-building workflows with synthetic prototype data. Money movement, unrestricted external actions, arbitrary local filesystem access, and uncontrolled self-modification are out of scope.

## Brand Commitments

Name: Orcha. Voice: clear, calm, capable, outcome-oriented. The product should feel like an executive control room for a living software company, not a generic chatbot or developer console.

## Evidence on Hand

The existing Orcha V1 starter-kit documentation and Python domain scaffold. Prototype metrics and activity are synthetic and must be labeled as such.

## Product Principles

- Outcome before activity.
- Autonomy with boundaries.
- Every visible motion corresponds to real event data.
- Measure before promoting change.
- Make progress legible in seconds.

## Accessibility & Inclusion

Keyboard navigation, visible focus, minimum 44px controls, reduced motion, semantic labels, and responsive behavior are required.

## Store readiness (iOS App Store and Google Play)

Orcha is for people 13 and older. It is not directed at children, not in Apple’s Kids Category, and not in Google Play’s Designed for Families program. Store listings must not say “for kids.”

Signup requires a 13+ confirmation and agreement to in-app Terms and Privacy Policy. Replies are labeled as AI. Orcha uses the models available to it, not a single vendor. Chat text is sent to those model providers only when Cloud AI is on; that switch is how the user withdraws consent to third-party AI sharing (App Store 5.1.2). Account deletion is in-app, complete (not a freeze), and also documented at `/delete-account` for Play’s web deletion URL. Privacy Policy is at `/privacy` for store metadata. Users can report an AI reply in the thread without leaving the app (Play generative-AI rule).

A native build must still: keep these URLs live, list the same data in App Privacy / Data safety, bundle fonts instead of Google Fonts, use the system document picker (not full photo-library access) for files, use In-App Purchase / Play Billing for any digital purchase, add Sign in with Apple if any other social login is added, and put a working `hello@orcha.app` on the listing. This web prototype cannot finish App Review by itself.
