export function Figure({ src, caption }: { src: string; caption?: string }) {
  return (
    <figure>
      <img src={src} alt="" />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}
