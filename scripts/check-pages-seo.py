"""생성된 Pages HTML·사이트맵·내부 링크의 오프라인 검증."""
import json
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / 'docs'
SITE = 'https://seo-gali.github.io/boiler-ops-agent/'


class Page(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.elements = []
        self.text = []
        self.ignored = 0
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        self.elements.append((tag, dict(attrs)))
        if tag in ('script', 'style'):
            self.ignored += 1

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.ignored -= 1

    def handle_data(self, data):
        if not self.ignored:
            self.text.append(data)


def check():
    home = Page((DOCS / 'index.html').read_text(encoding='utf-8'))
    features = json.loads((DOCS / 'feature-data.json').read_text(encoding='utf-8'))
    assert {attrs['data-feature'] for _, attrs in home.elements if 'data-feature' in attrs} == set(features), 'Feature callers and static panels differ'
    visible = ''.join(home.text)
    assert all(feature['title'] in visible for feature in features.values()), 'Code map requires JavaScript'
    root = ET.parse(DOCS / 'sitemap.xml').getroot()
    urls = [item.text for item in root.findall('{*}url/{*}loc')]
    assert SITE in urls and len(urls) > 1 and len(set(urls)) == len(urls), 'Incomplete or duplicate sitemap'
    assert all(url.startswith(SITE) and url != SITE + 'index.html' and '404.html' not in url for url in urls)
    links = 0
    for url in urls:
        relative = unquote(url.removeprefix(SITE)) or 'index.html'
        path = DOCS / relative
        assert path.is_file(), (url, 'Missing generated HTML')
        page = Page(path.read_text(encoding='utf-8'))
        assert len(''.join(page.text).strip()) > 100, (url, 'Empty HTML')
        canonical = [attrs.get('href') for tag, attrs in page.elements if tag == 'link' and attrs.get('rel') == 'canonical']
        assert canonical == [url], (url, canonical)
        assert any(tag == 'h1' for tag, _ in page.elements), (url, 'Missing heading')
        for tag, attrs in page.elements:
            if tag == 'meta' and attrs.get('name', '').lower() in ('robots', 'googlebot'):
                assert not {'noindex', 'none', 'nofollow'} & set(attrs.get('content', '').lower().replace(',', ' ').split()), (url, attrs)
            target = attrs.get('href') if tag in ('a', 'link') else attrs.get('src') if tag in ('img', 'script') else None
            if not target:
                continue
            destination = urlsplit(urljoin(url, target))
            assert destination.scheme in ('https', 'mailto'), (url, target)
            assert 'seoheejung.github.io' not in destination.netloc, (url, target)
            if destination.netloc != urlsplit(SITE).netloc:
                continue
            assert destination.path.startswith(urlsplit(SITE).path), (url, target, 'Outside published docs')
            local = DOCS / unquote(destination.path.removeprefix(urlsplit(SITE).path))
            if local.is_dir():
                local /= 'index.html'
            assert local.is_file(), (url, target, 'Dead internal link')
            if destination.fragment:
                linked = Page(local.read_text(encoding='utf-8'))
                assert any(attrs.get('id') == unquote(destination.fragment) for _, attrs in linked.elements), (url, target, 'Dead fragment')
            links += 1
    error = Page((DOCS / '404.html').read_text(encoding='utf-8'))
    bases = [attrs['href'] for tag, attrs in error.elements if tag == 'base']
    assert bases == [urlsplit(SITE).path], 'Deep 404 assets need the project base'
    assert any(tag == 'a' and urljoin(SITE, attrs.get('href', '')) == SITE for tag, attrs in error.elements)
    assert not any(tag == 'meta' and attrs.get('http-equiv', '').lower() == 'refresh' for tag, attrs in error.elements)
    robots = (DOCS / 'robots.txt').read_text(encoding='utf-8')
    assert 'User-agent: *' in robots and 'Allow: /' in robots and 'Disallow: /' not in robots
    assert 'Sitemap: ' + SITE + 'sitemap.xml' in robots
    report = {'passed': True, 'indexable_pages': len(urls), 'checked_internal_links': links,
              'scope': 'Generated HTML, sitemap and local files only'}
    output = ROOT / 'artifacts/pages-seo-check.json'
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    check()
