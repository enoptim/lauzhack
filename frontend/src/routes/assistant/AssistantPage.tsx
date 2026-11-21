import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function AssistantPage() {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle><h1>Assistant</h1></CardTitle>
          <CardDescription>The assistant is not connected yet.</CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}
