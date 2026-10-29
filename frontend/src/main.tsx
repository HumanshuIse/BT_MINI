import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserProvider, Contract, EventLog, formatEther, parseEther } from "ethers";
import { Activity, BadgeCheck, Blocks, HeartHandshake, LayoutDashboard, Menu, Plus, RefreshCw, ShieldCheck, Wallet, X } from "lucide-react";
import abiFile from "./generated/CharityChain.json";
import deployment from "./generated/deployment.json";
import "./index.css";

declare global { interface Window { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown>; on: (event: string, handler: (...args: unknown[]) => void) => void; removeListener: (event: string, handler: (...args: unknown[]) => void) => void }; } }
type Charity = { id: bigint; organizer: string; name: string; description: string; referenceId: string; evidenceUri: string; verified: boolean; active: boolean; createdAt: bigint };
type Campaign = { id: bigint; charityId: bigint; title: string; description: string; category: string; target: bigint; totalRaised: bigint; totalReleased: bigint; reservedPending: bigint; donationCount: bigint; createdAt: bigint; status: number; evidenceUri: string; available?: bigint };
type Expense = { id: bigint; campaignId: bigint; amount: bigint; description: string; evidenceUri: string; requestedAt: bigint; status: number; released: boolean };
const abi = abiFile.abi;
const short = (value: string) => `${value.slice(0, 6)}...${value.slice(-4)}`;
const statusName = (status: number) => ["Active", "Paused", "Closed"][status] ?? "Unknown";
const errorText = (error: unknown) => error instanceof Error ? error.message.replace(/^.*reason="?([^"]+)"?.*$/s, "$1") : "Transaction failed";
const toBigInt = (value: bigint | number | string | undefined) => BigInt(value ?? 0);

function App() {
  const [provider, setProvider] = useState<BrowserProvider>();
  const [signer, setSigner] = useState<Awaited<ReturnType<BrowserProvider["getSigner"]>>>();
  const [contract, setContract] = useState<Contract>();
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState<bigint>();
  const [balance, setBalance] = useState("0");
  const [admin, setAdmin] = useState("");
  const [charities, setCharities] = useState<Charity[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [page, setPage] = useState("dashboard");
  const [selected, setSelected] = useState<Campaign>();
  const [notice, setNotice] = useState<{ kind: "success" | "error" | "info"; text: string }>();
  const [busy, setBusy] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [donation, setDonation] = useState("");
  const [charityForm, setCharityForm] = useState({ name: "", description: "", reference: "", evidence: "" });
  const [campaignForm, setCampaignForm] = useState({ charityId: "", title: "", description: "", category: "Education", target: "" });
  const [expenseForm, setExpenseForm] = useState({ campaignId: "", amount: "", description: "", evidence: "" });

  const wrongNetwork = chainId !== undefined && chainId !== BigInt(deployment.chainId);
  const isAdmin = !!account && account.toLowerCase() === admin.toLowerCase();
  const totalRaised = campaigns.reduce((sum, c) => sum + toBigInt(c.totalRaised), 0n);
  const totalReleased = campaigns.reduce((sum, c) => sum + toBigInt(c.totalReleased), 0n);
  const activeCampaigns = campaigns.filter(c => c.status === 0).length;
  const pendingExpenses = expenses.filter(e => e.status === 0).length;

  async function refresh(activeProvider = provider) {
    if (!activeProvider || !deployment.address) return;
    const readContract = new Contract(deployment.address, abi, activeProvider);
    try {
      const charityIds = await readContract.getCharityIds() as bigint[];
      const campaignIds = await readContract.getCampaignIds() as bigint[];
      const loadedCharities = await Promise.all(charityIds.map(async id => readContract.charities(id) as Promise<Charity>));
      const loadedCampaigns = await Promise.all(campaignIds.map(async id => {
        const campaign = await readContract.campaigns(id) as Campaign;
        return {
          ...campaign,
          id: toBigInt(campaign.id),
          charityId: toBigInt(campaign.charityId),
          target: toBigInt(campaign.target),
          totalRaised: toBigInt(campaign.totalRaised),
          totalReleased: toBigInt(campaign.totalReleased),
          reservedPending: toBigInt(campaign.reservedPending),
          donationCount: toBigInt(campaign.donationCount),
          createdAt: toBigInt(campaign.createdAt),
          status: Number(campaign.status),
          available: toBigInt(await readContract.availableFunds(id) as bigint)
        };
      }));
      const loadedExpenses = (await Promise.all(campaignIds.map(async id => readContract.getExpenses(id) as Promise<Expense[]>))).flat().map(expense => ({
        ...expense,
        id: toBigInt(expense.id),
        campaignId: toBigInt(expense.campaignId),
        amount: toBigInt(expense.amount),
        requestedAt: toBigInt(expense.requestedAt),
        status: Number(expense.status)
      }));
      setCharities(loadedCharities); setCampaigns(loadedCampaigns); setExpenses(loadedExpenses);
      setAdmin(await readContract.administrator() as string);
    } catch (error) { setNotice({ kind: "error", text: `Could not read deployed contract: ${errorText(error)}` }); }
  }

  async function connect() {
    if (!window.ethereum) { setNotice({ kind: "error", text: "MetaMask is required. Install it and connect the Hardhat Local network." }); return; }
    try {
      const nextProvider = new BrowserProvider(window.ethereum);
      await nextProvider.send("eth_requestAccounts", []);
      const nextSigner = await nextProvider.getSigner();
      const network = await nextProvider.getNetwork();
      setProvider(nextProvider); setSigner(nextSigner); setContract(new Contract(deployment.address, abi, nextSigner));
      setAccount(await nextSigner.getAddress()); setChainId(network.chainId); setBalance(formatEther(await nextProvider.getBalance(await nextSigner.getAddress())));
      await refresh(nextProvider);
    } catch (error) { setNotice({ kind: "error", text: errorText(error) }); }
  }
  async function transact(action: () => Promise<{ wait: () => Promise<unknown> }>, success: string) {
    setBusy(true); setNotice({ kind: "info", text: "Transaction pending. Confirm it in MetaMask..." });
    try { const tx = await action(); await tx.wait(); setNotice({ kind: "success", text: success }); await refresh(); if (provider && account) setBalance(formatEther(await provider.getBalance(account))); }
    catch (error) { setNotice({ kind: "error", text: errorText(error) }); } finally { setBusy(false); }
  }
  useEffect(() => { if (window.ethereum) { const changed = () => void connect(); window.ethereum.on("accountsChanged", changed); window.ethereum.on("chainChanged", changed); return () => { window.ethereum?.removeListener("accountsChanged", changed); window.ethereum?.removeListener("chainChanged", changed); }; } }, []);
  useEffect(() => { void refresh(); }, [provider]);

  const charityById = useMemo(() => new Map(charities.map(c => [c.id.toString(), c])), [charities]);
  const go = (next: string) => { setPage(next); setShowMenu(false); };
  const run = (call: Promise<{ wait: () => Promise<unknown> }>, message: string) => transact(() => call, message);
  async function registerCharity() { if (!contract) return; await run(contract.registerCharity(charityForm.name, charityForm.description, charityForm.reference, charityForm.evidence), "Charity registered on-chain."); setCharityForm({ name: "", description: "", reference: "", evidence: "" }); }
  async function createCampaign() { if (!contract) return; await run(contract.createCampaign(campaignForm.charityId, campaignForm.title, campaignForm.description, campaignForm.category, parseEther(campaignForm.target), ""), "Campaign created on-chain."); setCampaignForm({ charityId: "", title: "", description: "", category: "Education", target: "" }); }
  async function donate() { if (!contract || !selected || !donation) return; await run(contract.donate(selected.id, { value: parseEther(donation) }), `Donation confirmed for ${selected.title}.`); setDonation(""); }
  async function requestExpense() { if (!contract) return; await run(contract.requestExpense(expenseForm.campaignId, parseEther(expenseForm.amount), expenseForm.description, expenseForm.evidence), "Expense request submitted for review."); setExpenseForm({ campaignId: "", amount: "", description: "", evidence: "" }); }
  const guarded = !account || wrongNetwork || !contract;

  return <div className="app-shell">
    <aside className={`sidebar ${showMenu ? "open" : ""}`}><div className="brand"><div className="brand-mark"><HeartHandshake size={23} /></div><div><strong>CharityChain</strong><span>Transparent impact</span></div><button className="icon-button mobile-close" onClick={() => setShowMenu(false)}><X size={18} /></button></div>
      <nav>{[["dashboard", LayoutDashboard, "Overview"], ["campaigns", HeartHandshake, "Campaigns"], ["charities", ShieldCheck, "Charities"], ["expenses", Activity, "Expenses"], ["ledger", Blocks, "Blockchain ledger"]].map(([id, Icon, label]) => <button key={id as string} className={page === id ? "active" : ""} onClick={() => go(id as string)}><Icon size={18} />{label as string}</button>)}</nav>
      <div className="sidebar-note"><ShieldCheck size={16} /><span>Local educational prototype. Verification is administrator approval, not proof of real-world legitimacy.</span></div>
    </aside>
    <main><header><button className="icon-button menu-button" onClick={() => setShowMenu(true)}><Menu size={20} /></button><div><p className="eyebrow">CHARITY TRANSPARENCY PROTOCOL</p><h1>{page === "dashboard" ? "Good evening, changemaker." : page[0].toUpperCase() + page.slice(1)}</h1></div><div className="header-actions">{account && <div className="balance"><span>{balance} ETH</span><small>{short(account)}</small></div>}<button className="wallet-button" onClick={connect}><Wallet size={17} />{account ? short(account) : "Connect wallet"}</button></div></header>
      {notice && <div className={`notice ${notice.kind}`}>{notice.text}<button onClick={() => setNotice(undefined)}>×</button></div>}
      {wrongNetwork && <div className="network-warning">Wrong network. Switch MetaMask to Hardhat Local (chain ID {deployment.chainId}) before sending transactions.</div>}
      {page === "dashboard" && <Dashboard campaigns={campaigns} charities={charities} totalRaised={totalRaised} totalReleased={totalReleased} activeCampaigns={activeCampaigns} pendingExpenses={pendingExpenses} onCampaign={c => { setSelected(c); go("campaigns"); }} />}
      {page === "campaigns" && <Campaigns campaigns={campaigns} charities={charityById} selected={selected} onSelect={setSelected} donation={donation} setDonation={setDonation} onDonate={donate} disabled={guarded || busy} />}
      {page === "charities" && <Charities charities={charities} isAdmin={isAdmin} disabled={guarded || busy} form={charityForm} setForm={setCharityForm} onRegister={registerCharity} onVerify={id => contract && run(contract.updateCharityVerification(id, true), "Charity marked administrator-approved.")} campaignForm={campaignForm} setCampaignForm={setCampaignForm} onCampaign={createCampaign} />}
      {page === "expenses" && <Expenses campaigns={campaigns} expenses={expenses} isAdmin={isAdmin} disabled={guarded || busy} form={expenseForm} setForm={setExpenseForm} onRequest={requestExpense} onApprove={id => contract && run(contract.approveExpense(id), "Expense approved and funds released.")} onReject={id => contract && run(contract.rejectExpense(id), "Expense rejected.")} />}
      {page === "ledger" && <Ledger contract={contract} />}
    </main>
  </div>;
}

function Dashboard({ campaigns, charities, totalRaised, totalReleased, activeCampaigns, pendingExpenses, onCampaign }: { campaigns: Campaign[]; charities: Charity[]; totalRaised: bigint; totalReleased: bigint; activeCampaigns: number; pendingExpenses: number; onCampaign: (c: Campaign) => void }) {
  return <><section className="hero"><div><span className="pill"><span className="pulse" />LIVE ON LOCAL BLOCKCHAIN</span><h2>Every donation.<br /><em>Every transaction.</em><br />Every impact.</h2><p>CharityChain makes campaign funding traceable from the first contribution to every administrator-approved release.</p><button className="primary" onClick={() => onCampaign(campaigns[0])}>Explore campaigns <span>→</span></button></div><div className="hero-graphic"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><HeartHandshake size={72} /><small>ON-CHAIN<br />TRANSPARENCY</small></div></section>
    <div className="stat-grid"><Stat label="Total donations" value={`${formatEther(totalRaised)} ETH`} icon="↗" /><Stat label="Verified charities" value={`${charities.filter(c => c.verified).length}`} icon="✓" /><Stat label="Active campaigns" value={`${activeCampaigns}`} icon="◈" /><Stat label="Funds released" value={`${formatEther(totalReleased)} ETH`} icon="→" /><Stat label="Pending requests" value={`${pendingExpenses}`} icon="!" /></div>
    <section className="section-heading"><div><p className="eyebrow">DISCOVER</p><h3>Featured campaigns</h3></div><span className="muted">{campaigns.length} on-chain campaigns</span></section>
    {campaigns.length === 0 ? <Empty title="No campaigns yet" text="Connect a wallet and register a charity to create the first campaign." /> : <div className="campaign-grid">{campaigns.slice(0, 3).map(c => <CampaignCard key={c.id.toString()} campaign={c} charity={charities.find(x => x.id === c.charityId)} onClick={() => onCampaign(c)} />)}</div>}
    <section className="how"><div><p className="eyebrow">HOW IT WORKS</p><h3>Trust, recorded by design.</h3></div><div className="steps">{["Donor connects wallet", "Smart contract records donation", "Organizer requests expense", "Administrator approves release"].map((step, i) => <div className="step" key={step}><b>0{i + 1}</b><span>{step}</span></div>)}</div></section>
  </>;
}
function Stat({ label, value, icon }: { label: string; value: string; icon: string }) { return <div className="stat"><span className="stat-icon">{icon}</span><div><small>{label}</small><strong>{value}</strong></div></div>; }
function CampaignCard({ campaign, charity, onClick }: { campaign: Campaign; charity?: Charity; onClick: () => void }) { const pct = Number(campaign.totalRaised * 100n / campaign.target); return <article className="campaign-card" onClick={onClick}><div className="card-top"><span className="category">{campaign.category}</span><span className={campaign.status === 0 ? "status active" : "status"}>{statusName(campaign.status)}</span></div><h4>{campaign.title}</h4><p>{campaign.description}</p><div className="charity-line">{charity?.verified && <BadgeCheck size={16} />} {charity?.name ?? "Unknown charity"}</div><div className="progress-label"><span>{formatEther(campaign.totalRaised)} ETH raised</span><span>{formatEther(campaign.target)} ETH goal</span></div><div className="progress"><span style={{ width: `${Math.min(pct, 100)}%` }} /></div><button className="text-button">View details →</button></article>; }
function Campaigns({ campaigns, charities, selected, onSelect, donation, setDonation, onDonate, disabled }: { campaigns: Campaign[]; charities: Map<string, Charity>; selected?: Campaign; onSelect: (c: Campaign) => void; donation: string; setDonation: (v: string) => void; onDonate: () => void; disabled: boolean }) { return <><div className="section-heading"><div><p className="eyebrow">ON-CHAIN FUNDRAISING</p><h3>Campaign explorer</h3></div></div>{campaigns.length === 0 ? <Empty title="No campaigns found" text="Campaigns created by registered organizers will appear here." /> : <div className="campaign-grid">{campaigns.map(c => <CampaignCard key={c.id.toString()} campaign={c} charity={charities.get(c.charityId.toString())} onClick={() => onSelect(c)} />)}</div>}{selected && <div className="detail-panel"><div><button className="close-link" onClick={() => onSelect(undefined as unknown as Campaign)}>× Close</button><span className="category">{selected.category}</span><h3>{selected.title}</h3><p>{selected.description}</p><dl><div><dt>Raised</dt><dd>{formatEther(selected.totalRaised)} ETH</dd></div><div><dt>Available</dt><dd>{formatEther(selected.available ?? 0n)} ETH</dd></div><div><dt>Released</dt><dd>{formatEther(selected.totalReleased)} ETH</dd></div><div><dt>Donations</dt><dd>{selected.donationCount.toString()}</dd></div></dl></div><div className="donate-box"><p className="eyebrow">MAKE AN IMPACT</p><h4>Donate to this campaign</h4><p>Transactions use test ETH on your local Hardhat network.</p><input value={donation} onChange={e => setDonation(e.target.value)} placeholder="0.10 ETH" /><button className="primary full" disabled={disabled || !donation} onClick={onDonate}>Confirm donation <span>→</span></button>{disabled && <small className="muted">Connect MetaMask on the configured local network to donate.</small>}</div></div>}</>; }
function Charities({ charities, isAdmin, disabled, form, setForm, onRegister, onVerify, campaignForm, setCampaignForm, onCampaign }: { charities: Charity[]; isAdmin: boolean; disabled: boolean; form: { name: string; description: string; reference: string; evidence: string }; setForm: (v: typeof form) => void; onRegister: () => void; onVerify: (id: bigint) => void; campaignForm: { charityId: string; title: string; description: string; category: string; target: string }; setCampaignForm: (v: typeof campaignForm) => void; onCampaign: () => void }) { return <><section className="form-grid"><FormCard title="Register a charity"><input placeholder="Charity name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /><textarea placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /><input placeholder="Registration reference" value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} /><input placeholder="Evidence URI (optional)" value={form.evidence} onChange={e => setForm({ ...form, evidence: e.target.value })} /><button className="primary" disabled={disabled || !form.name} onClick={onRegister}><Plus size={16} /> Register on-chain</button></FormCard><FormCard title="Create a campaign"><select value={campaignForm.charityId} onChange={e => setCampaignForm({ ...campaignForm, charityId: e.target.value })}><option value="">Select your charity</option>{charities.map(c => <option value={c.id.toString()} key={c.id.toString()}>{c.name}</option>)}</select><input placeholder="Campaign title" value={campaignForm.title} onChange={e => setCampaignForm({ ...campaignForm, title: e.target.value })} /><textarea placeholder="Description" value={campaignForm.description} onChange={e => setCampaignForm({ ...campaignForm, description: e.target.value })} /><input placeholder="Funding goal in ETH" value={campaignForm.target} onChange={e => setCampaignForm({ ...campaignForm, target: e.target.value })} /><button className="primary" disabled={disabled || !campaignForm.charityId || !campaignForm.target} onClick={onCampaign}><Plus size={16} /> Create campaign</button></FormCard></section><div className="list">{charities.map(c => <div className="list-row" key={c.id.toString()}><div className="avatar"><ShieldCheck size={18} /></div><div className="grow"><strong>{c.name}</strong><span>{c.description}</span><small>{short(c.organizer)} · {c.referenceId || "No reference"}</small></div><span className={c.verified ? "badge verified" : "badge pending"}>{c.verified ? "Administrator-approved" : "Pending review"}</span>{isAdmin && !c.verified && <button className="secondary" disabled={disabled} onClick={() => onVerify(c.id)}>Approve</button>}</div>)}</div></>; }
function FormCard({ title, children }: { title: string; children: React.ReactNode }) { return <div className="form-card"><h4>{title}</h4>{children}</div>; }
function Expenses({ campaigns, expenses, isAdmin, disabled, form, setForm, onRequest, onApprove, onReject }: { campaigns: Campaign[]; expenses: Expense[]; isAdmin: boolean; disabled: boolean; form: { campaignId: string; amount: string; description: string; evidence: string }; setForm: (v: typeof form) => void; onRequest: () => void; onApprove: (id: bigint) => void; onReject: (id: bigint) => void }) { return <><FormCard title="Submit an expense request"><select value={form.campaignId} onChange={e => setForm({ ...form, campaignId: e.target.value })}><option value="">Select campaign</option>{campaigns.map(c => <option value={c.id.toString()} key={c.id.toString()}>{c.title} · {formatEther(c.available ?? 0n)} ETH available</option>)}</select><input placeholder="Amount in ETH" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /><textarea placeholder="Purpose and description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /><input placeholder="Evidence or invoice URI" value={form.evidence} onChange={e => setForm({ ...form, evidence: e.target.value })} /><button className="primary" disabled={disabled || !form.campaignId || !form.amount} onClick={onRequest}>Submit for approval</button></FormCard><div className="list">{expenses.length === 0 ? <Empty title="No expense requests" text="Organizer-submitted requests will be visible to donors and administrators." /> : expenses.map(e => <div className="list-row" key={e.id.toString()}><div className="grow"><strong>Request #{e.id.toString()} · {formatEther(e.amount)} ETH</strong><span>{campaigns.find(c => c.id === e.campaignId)?.title ?? `Campaign #${e.campaignId}`}</span><small>{e.description} · {e.evidenceUri || "No evidence URI"}</small></div><span className={`badge ${e.status === 0 ? "pending" : e.status === 1 ? "verified" : "rejected"}`}>{["Pending", "Released", "Rejected"][e.status]}</span>{isAdmin && e.status === 0 && <><button className="secondary" disabled={disabled} onClick={() => onApprove(e.id)}>Approve & release</button><button className="danger" disabled={disabled} onClick={() => onReject(e.id)}>Reject</button></>}</div>)}</div></>; }
function Ledger({ contract }: { contract?: Contract }) { const [events, setEvents] = useState<{ name: string; args: string[]; block?: number; hash?: string }[]>([]); useEffect(() => { if (!contract) return; let cancelled = false; void (async () => { const logs = await contract.queryFilter("*"); if (!cancelled) setEvents(logs.slice(-30).reverse().map(log => { const event = log as EventLog; return { name: event.fragment?.name ?? "Event", args: event.args?.map(String) ?? [], block: event.blockNumber, hash: event.transactionHash }; })); })().catch(() => setEvents([])); return () => { cancelled = true; }; }, [contract]); return <><div className="section-heading"><div><p className="eyebrow">VERIFIABLE ACTIVITY</p><h3>Blockchain ledger</h3></div><button className="secondary"><RefreshCw size={15} /> Actual contract events</button></div><div className="ledger">{events.length === 0 ? <Empty title="No indexed activity yet" text="Confirmed contract events will appear here after deployment and activity." /> : events.map((e, i) => <div className="ledger-row" key={`${e.hash}-${i}`}><span className="event-dot" /><div className="grow"><strong>{e.name}</strong><span>{e.args[0] ? `Record ${e.args[0]}` : "Contract activity"} · {e.args[1]?.startsWith("0x") ? short(e.args[1]) : ""}</span></div><code>{e.hash ? short(e.hash) : "pending"}</code><small>Block {e.block}</small></div>)}</div></>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className="empty"><Blocks size={28} /><h4>{title}</h4><p>{text}</p></div>; }

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
