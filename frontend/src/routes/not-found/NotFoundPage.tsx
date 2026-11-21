import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function NotFoundPage() {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle><h1>Page not found</h1></CardTitle>
          <CardDescription>Check the address and try again.</CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}
