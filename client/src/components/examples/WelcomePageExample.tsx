import WelcomePage from '../WelcomePage';

export default function WelcomePageExample() {
  return (
    <WelcomePage onComplete={() => console.log('Welcome animation complete')} />
  );
}
