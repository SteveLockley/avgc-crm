export const CLUB_INFO = {
  name: 'Alnmouth Village Golf Club',
  url: 'https://www.alnmouthvillage.golf',
  telephone: '+441665830370',
  email: 'Manager@AlnmouthVillage.Golf',
  foundingDate: '1869',
  address: {
    '@type': 'PostalAddress' as const,
    streetAddress: 'Marine Road',
    addressLocality: 'Alnmouth',
    addressRegion: 'Northumberland',
    postalCode: 'NE66 2RZ',
    addressCountry: 'GB',
  },
  geo: {
    '@type': 'GeoCoordinates' as const,
    latitude: 55.3869,
    longitude: -1.6111,
  },
  sameAs: [
    'https://www.facebook.com/p/Alnmouth-Village-Golf-Club-100063579043415/',
    'https://www.instagram.com/alnmouthvillagegolf/',
  ],
  image: 'https://www.alnmouthvillage.golf/images/hero-course.jpg',
};

export interface HoursForSchema {
  day_of_week: number | null;
  open_time: string;
  close_time: string;
  is_closed: boolean;
}

const SCHEMA_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function buildOpeningHoursSpec(hours: HoursForSchema[]) {
  return hours
    .filter(h => h.day_of_week !== null && !h.is_closed && h.open_time.includes(':') && h.close_time.includes(':'))
    .map(h => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: SCHEMA_DAYS[h.day_of_week!],
      opens: h.open_time,
      closes: h.close_time,
    }));
}

export function golfCourseSchema(hours?: HoursForSchema[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'GolfCourse',
    name: CLUB_INFO.name,
    description: 'The oldest 9-hole links course in England, offering challenging golf with spectacular sea views since 1869.',
    url: CLUB_INFO.url,
    telephone: CLUB_INFO.telephone,
    email: CLUB_INFO.email,
    foundingDate: CLUB_INFO.foundingDate,
    address: CLUB_INFO.address,
    geo: CLUB_INFO.geo,
    sameAs: CLUB_INFO.sameAs,
    image: CLUB_INFO.image,
    priceRange: '$$',
    numberOfHoles: 9,
    amenityFeature: [
      { '@type': 'LocationFeatureSpecification', name: 'Clubhouse', value: true },
      { '@type': 'LocationFeatureSpecification', name: 'Bar', value: true },
      { '@type': 'LocationFeatureSpecification', name: 'Catering', value: true },
      { '@type': 'LocationFeatureSpecification', name: 'Car Park', value: true },
    ],
    ...(hours?.length ? { openingHoursSpecification: buildOpeningHoursSpec(hours) } : {}),
  };
}

export function localBusinessSchema(hours?: HoursForSchema[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsActivityLocation',
    '@id': CLUB_INFO.url,
    name: CLUB_INFO.name,
    url: CLUB_INFO.url,
    telephone: CLUB_INFO.telephone,
    email: CLUB_INFO.email,
    foundingDate: CLUB_INFO.foundingDate,
    address: CLUB_INFO.address,
    geo: CLUB_INFO.geo,
    sameAs: CLUB_INFO.sameAs,
    image: 'https://www.alnmouthvillage.golf/images/clubhouse.jpg',
    ...(hours?.length ? { openingHoursSpecification: buildOpeningHoursSpec(hours) } : {}),
  };
}

export function faqPageSchema(faqs: { question: string; answer: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(faq => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  };
}

export function newsArticleSchema(article: {
  title: string;
  excerpt?: string;
  image?: string;
  slug: string;
  publishDate?: string;
  updatedAt?: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: article.title,
    description: article.excerpt || article.title,
    ...(article.image ? { image: article.image } : {}),
    url: `${CLUB_INFO.url}/news/${article.slug}`,
    ...(article.publishDate ? { datePublished: article.publishDate } : {}),
    ...(article.updatedAt || article.publishDate ? { dateModified: article.updatedAt || article.publishDate } : {}),
    author: {
      '@type': 'Organization',
      name: CLUB_INFO.name,
      url: CLUB_INFO.url,
    },
    publisher: {
      '@type': 'Organization',
      name: CLUB_INFO.name,
      url: CLUB_INFO.url,
    },
  };
}
