import { Link, useSearchParams } from 'react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { readConfig } from './config';

export default function ResultsPage() {
  const [params] = useSearchParams();
  const read = readConfig(params);

  return (
    <main className="grid min-h-full place-items-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle><h1>Results</h1></CardTitle>
          <CardDescription>
            {read === null ? 'The configuration in the page address is broken.'
              : read.isDemo ? 'No configuration received. Showing the demo upgrade.'
              : `${read.config.scenario.length} ${read.config.scenario.length === 1 ? 'change' : 'changes'} received from the building.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {read && <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(read.config, null, 2)}</pre>}
          <Link to="/" className="text-sm underline underline-offset-4">Change the configuration</Link>
        </CardContent>
      </Card>
    </main>
  );
}
