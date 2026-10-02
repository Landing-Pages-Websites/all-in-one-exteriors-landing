"use client";

const slides = [
  { title: "Venue types", note: "Where the network reaches", href: "/networks" },
  { title: "Audiences", note: "Who it reaches", href: "/audiences" },
];

export function Carousel() {
  return (
    <ul>
      {slides.map((slide) => (
        <li key={slide.title}>
          <a href={slide.href}>
            <span>{slide.title}</span>
          </a>
          <p>{slide.note}</p>
        </li>
      ))}
    </ul>
  );
}
