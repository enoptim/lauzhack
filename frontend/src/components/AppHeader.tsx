import { matchPath, useLocation, useNavigate } from 'react-router';
import AssistantChat from '@/components/assistant/AssistantChat';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type PageLink = { path: string; label: string };

export default function AppHeader({ pages }: { pages: readonly PageLink[] }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const currentPage = pages.find(({ path }) => matchPath(path, pathname));

  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-background px-4 py-2">
      <span className="font-semibold">Building Twin</span>
      <div className="flex items-center gap-2">
        <AssistantChat />
        <nav aria-label="Page navigation">
          <Select value={currentPage?.path ?? ''} onValueChange={(path) => navigate(path)}>
            <SelectTrigger aria-label="Go to page" className="w-36">
              <SelectValue placeholder="Go to page" />
            </SelectTrigger>
            <SelectContent position="popper" align="end">
              <SelectGroup>
                {pages.map(({ path, label }) => (
                  <SelectItem key={path} value={path}>{label}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </nav>
      </div>
    </header>
  );
}
