import { BoardDemo } from "./components/BoardDemo.js";

export function App() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-white">@hasna/draw</h1>
        <p className="mt-1 max-w-2xl text-sm text-[#8b90a0]">
          Headless board SDK for quick notes and freehand drawings, like Google Keep. Add a note or
          sketch a card on the right; the board renders on the left and the SDK serializes it to
          JSON and a portable Excalidraw scene, all from the same model.
        </p>
      </header>
      <BoardDemo />
    </div>
  );
}
