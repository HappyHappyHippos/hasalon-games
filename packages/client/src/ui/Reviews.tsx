import type { JSX } from 'react';
import { useT } from '../strings';

/**
 * Reviews, in the sense that a shampoo bottle has reviews.
 *
 * The quotes stay in Hebrew whatever the UI language is — a 07:00 siren and
 * shawarma discourse do not survive translation, and a joke explained is a joke
 * lost. Each one carries its own `dir`/`lang` so it still sets correctly inside
 * an LTR page. Only the heading follows the interface.
 */
interface Review {
  quote: string;
  /** Attribution. Made up, and meant to read that way. */
  by: string;
}

const REVIEWS: Review[] = [
  { quote: 'זה מעביר לי בצ׳יק את האזעקה של 07:00', by: 'דודה שלי, מבקרת תרבות' },
  { quote: 'שווארמה זה אוברייטד', by: 'אנונימי, טעה בטופס' },
  {
    quote: 'זה אתר כל כך מגניב איך אני יכול לתרום לכם מלא כסף?',
    by: 'לקוח מרוצה במיוחד',
  },
];

export function Reviews(): JSX.Element {
  const t = useT();

  return (
    <section className="home__reviews">
      <h2 className="eyebrow">{t.reviewsHeading}</h2>
      <div className="reviews">
        {REVIEWS.map((review) => (
          <figure
            key={review.quote}
            className="sticker review"
          >
            <blockquote className="review__quote" dir="rtl" lang="he">
              {review.quote}
            </blockquote>
            <figcaption className="review__by" dir="rtl" lang="he">
              {review.by}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
