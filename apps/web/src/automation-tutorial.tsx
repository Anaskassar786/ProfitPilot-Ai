import { Button } from './polaris-ui.js'
import { Compass, ListChecks, Play, Rocket, Target, X } from './icons.js'
import type { JSX } from 'react'

/** Educational "How automations work" content — reused by the hub and the editor. */
export function HowItWorksContent(): JSX.Element {
  return (
    <div className="how-it-works">
      <div className="how-step">
        <span className="how-step-icon"><Target size={18} /></span>
        <div>
          <strong>Step 1 · Choose a starting point</strong>
          <p>Pick what starts your automation — like a new customer signing up, an order being placed, or a cart being abandoned.</p>
        </div>
      </div>
      <div className="how-step">
        <span className="how-step-icon"><ListChecks size={18} /></span>
        <div>
          <strong>Step 2 · Add checks (optional)</strong>
          <p>Only run when it makes sense, like orders over $100 or customers who haven&rsquo;t bought in a while.</p>
        </div>
      </div>
      <div className="how-step">
        <span className="how-step-icon"><Play size={18} /></span>
        <div>
          <strong>Step 3 · Choose what happens</strong>
          <p>Decide the result — send an email, add a customer tag, create a discount code, or notify you.</p>
        </div>
      </div>
      <div className="how-step">
        <span className="how-step-icon"><Rocket size={18} /></span>
        <div>
          <strong>Step 4 · Test &amp; activate</strong>
          <p>Try it with sample data first, then turn it on. You can pause or edit it any time — nothing is locked in.</p>
        </div>
      </div>
    </div>
  )
}

export function HowItWorksModal({
  onClose,
  onStartBuilding,
  onBrowseTemplates,
}: {
  onClose: () => void
  onStartBuilding: () => void
  onBrowseTemplates: () => void
}): JSX.Element {
  return (
    <div className="automation-modal-backdrop">
      <div className="automation-modal how-it-works-modal">
        <Button className="modal-close" onClick={onClose} aria-label="Close"><X size={18} /></Button>
        <span className="automation-eyebrow">LEARN THE BASICS</span>
        <h2>How automations work</h2>
        <p>Automations follow a simple recipe: when something happens, check if it matters, then do something about it.</p>
        <HowItWorksContent />
        <footer>
          <Button className="automation-secondary" onClick={onBrowseTemplates}><Compass size={15} /> Browse Templates</Button>
          <Button className="automation-primary" onClick={onStartBuilding}><Rocket size={15} /> Start Building</Button>
        </footer>
      </div>
    </div>
  )
}
