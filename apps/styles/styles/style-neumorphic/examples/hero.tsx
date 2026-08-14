// Neumorphic Hero — soft surfaces, extruded card hero, monochromatic
export function Hero() {
  return (
    <section className="min-h-[60vh] bg-gray-100 flex items-center justify-center px-6 py-20">
      <div className="max-w-lg w-full text-center">
        {/* Extruded hero card */}
        <div className="bg-gray-100 rounded-3xl p-10 shadow-[16px_16px_32px_#b0b0b0,-16px_-16px_32px_#ffffff]">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6 bg-gray-100 shadow-[6px_6px_12px_#bebebe,-6px_-6px_12px_#ffffff] text-gray-600 text-2xl">
            ◎
          </div>
          <h1 className="text-3xl font-semibold text-gray-700 leading-tight mb-4 tracking-tight">
            Soft, tactile,<br />and physical.
          </h1>
          <p className="text-sm text-gray-500 leading-relaxed mb-8">
            Elements that feel carved from the surface. UI that invites you to press,
            slide, and interact.
          </p>
          <button className="
            px-8 py-3 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl
            shadow-[6px_6px_12px_#bebebe,-6px_-6px_12px_#ffffff]
            hover:shadow-[4px_4px_8px_#bebebe,-4px_-4px_8px_#ffffff]
            active:shadow-[inset_4px_4px_8px_#bebebe,inset_-4px_-4px_8px_#ffffff]
            transition-shadow
          ">
            Explore
          </button>
        </div>
      </div>
    </section>
  );
}
