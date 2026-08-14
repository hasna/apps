import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export default function HomePage() {
  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-6">Conversations Dashboard</h1>
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {/* Add your dashboard components here */}
        </div>
      </Suspense>
    </div>
  );
}