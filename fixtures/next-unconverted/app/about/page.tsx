import { Feature } from "../../components/Feature";

export default function About() {
  return (
    <>
      <h1>The crew</h1>
      <Feature
        title="How we work"
        lead="One crew from survey to installation."
        aside={<span>Twelve people</span>}
      />
    </>
  );
}
