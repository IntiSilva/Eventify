import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders, screen } from '@/test/test-utils';
import SearchResultsTitle from '@/components/AnimatedText/SearchResultsTitle';

vi.mock('@/components/AnimatedText/AnimatedColorableText', () => ({
  __esModule: true,
  default: ({ tokens }: { tokens: Array<{ text: string }> }) => (
    <div data-testid="srt-tokens">{tokens.map((t) => t.text).join(' ')}</div>
  ),
}));

vi.mock('@/components/LordIcons/AnimatedIcon', () => ({
  __esModule: true,
  default: () => null,
}));

describe('SearchResultsTitle (paid/free)', () => {
  it('renders a meaningful title for paid-only filters', () => {
    renderWithProviders(<SearchResultsTitle paid="paid" />);
    expect(screen.getByTestId('srt-tokens')).toHaveTextContent('Paid events');
  });

  it('renders a meaningful title for free-only filters', () => {
    renderWithProviders(<SearchResultsTitle paid="free" />);
    expect(screen.getByTestId('srt-tokens')).toHaveTextContent('Free events');
  });

  it('combines paid with search text naturally', () => {
    renderWithProviders(<SearchResultsTitle searchTerm="jazz" paid="paid" />);
    expect(screen.getByTestId('srt-tokens')).toHaveTextContent(
      'Results for "jazz" among Paid events'
    );
  });

  it('combines paid/free with category and advanced fields', () => {
    renderWithProviders(
      <SearchResultsTitle
        paid="free"
        category="music"
        location="buenos aires"
        creator="alice"
        date="2026-03-20"
      />
    );

    const txt = screen.getByTestId('srt-tokens');
    expect(txt).toHaveTextContent('Free events in Music');
    expect(txt).toHaveTextContent('at Buenos aires');
    expect(txt).toHaveTextContent('Organized by Alice');
    expect(txt).toHaveTextContent('on');
  });
});
