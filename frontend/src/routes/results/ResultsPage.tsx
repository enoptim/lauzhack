import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function ResultsPage() {
  return (
    <main className="grid min-h-full place-items-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle><h1>Results</h1></CardTitle>
          <CardDescription>No scenario selected.</CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}
