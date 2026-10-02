"use client";

const slides = [
  { title: "Venue types", note: "Where the network reaches" },
  { title: "Audiences", note: "Who it reaches" },
];

export function Carousel() {
  return (
    <ul>
      {slides.map((slide) => (
        <li key={slide.title}>
          <h3>{slide.title}</h3>
          <p>{slide.note}</p>
        </li>
      ))}
    </ul>
  );
}
