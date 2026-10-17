/**
 * A gold game piece with a first letter on it: the token from /create's track (plan §19),
 * also used for games without a screenshot and for people on their profile. Decorative:
 * the name it stands for is always written next to it.
 *
 * @param {{ name: string }} props
 */
export default function Token({ name }) {
  return (
    <span className="token" aria-hidden="true">
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
