import { AssetImage } from '../assets.jsx';

/** { view: 'message', title, text?, asset? }: big text, optional smaller text and picture. */
export default function MessageView({ view }) {
  return (
    <div className="view view-message">
      <AssetImage id={view.asset} />
      <h2>{view.title}</h2>
      {view.text && <p>{view.text}</p>}
    </div>
  );
}
