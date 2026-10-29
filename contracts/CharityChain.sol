// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract CharityChain {
    address public immutable administrator;

    enum CampaignStatus { Active, Paused, Closed }
    enum ExpenseStatus { Pending, Approved, Rejected }

    struct Charity {
        uint256 id;
        address organizer;
        string name;
        string description;
        string referenceId;
        string evidenceUri;
        bool verified;
        bool active;
        uint64 createdAt;
    }

    struct Campaign {
        uint256 id;
        uint256 charityId;
        string title;
        string description;
        string category;
        uint256 target;
        uint256 totalRaised;
        uint256 totalReleased;
        uint256 reservedPending;
        uint256 donationCount;
        uint64 createdAt;
        CampaignStatus status;
        string evidenceUri;
    }

    struct Donation {
        address donor;
        uint256 amount;
        uint64 timestamp;
        uint256 blockNumber;
    }

    struct ExpenseRequest {
        uint256 id;
        uint256 campaignId;
        uint256 amount;
        string description;
        string evidenceUri;
        uint64 requestedAt;
        ExpenseStatus status;
        bool released;
    }

    uint256 public nextCharityId = 1;
    uint256 public nextCampaignId = 1;
    uint256 public nextExpenseId = 1;
    mapping(uint256 => Charity) public charities;
    mapping(uint256 => Campaign) public campaigns;
    mapping(uint256 => Donation[]) private campaignDonations;
    mapping(uint256 => ExpenseRequest[]) private campaignExpenses;
    uint256[] private charityIds;
    uint256[] private campaignIds;
    mapping(uint256 => uint256) private expenseIndexById;
    mapping(uint256 => uint256) private expenseCampaignById;

    error Unauthorized();
    error InvalidId();
    error InvalidAmount();
    error InactiveCampaign();
    error NotOrganizer();
    error AlreadyVerified();
    error InvalidStatus();
    error InsufficientAvailableFunds();
    error TransferFailed();

    event CharityRegistered(uint256 indexed charityId, address indexed organizer, string name);
    event CharityVerificationUpdated(uint256 indexed charityId, bool verified);
    event CampaignCreated(uint256 indexed campaignId, uint256 indexed charityId, string title);
    event DonationReceived(uint256 indexed campaignId, address indexed donor, uint256 amount);
    event CampaignStatusChanged(uint256 indexed campaignId, CampaignStatus status);
    event ExpenseRequested(uint256 indexed expenseId, uint256 indexed campaignId, uint256 amount);
    event ExpenseApproved(uint256 indexed expenseId, uint256 indexed campaignId, uint256 amount);
    event ExpenseRejected(uint256 indexed expenseId, uint256 indexed campaignId);
    event FundsReleased(uint256 indexed expenseId, uint256 indexed campaignId, address indexed recipient, uint256 amount);

    modifier onlyAdmin() {
        if (msg.sender != administrator) revert Unauthorized();
        _;
    }

    modifier validCharity(uint256 charityId) {
        if (charityId == 0 || charityId >= nextCharityId) revert InvalidId();
        _;
    }

    modifier validCampaign(uint256 campaignId) {
        if (campaignId == 0 || campaignId >= nextCampaignId) revert InvalidId();
        _;
    }

    constructor() {
        administrator = msg.sender;
    }

    function registerCharity(
        string calldata name,
        string calldata description,
        string calldata referenceId,
        string calldata evidenceUri
    ) external returns (uint256 charityId) {
        if (bytes(name).length == 0) revert InvalidAmount();
        charityId = nextCharityId++;
        charities[charityId] = Charity(charityId, msg.sender, name, description, referenceId, evidenceUri, false, true, uint64(block.timestamp));
        charityIds.push(charityId);
        emit CharityRegistered(charityId, msg.sender, name);
    }

    function updateCharityVerification(uint256 charityId, bool verified) external onlyAdmin validCharity(charityId) {
        Charity storage charity = charities[charityId];
        if (!charity.active) revert InvalidStatus();
        charity.verified = verified;
        emit CharityVerificationUpdated(charityId, verified);
    }

    function createCampaign(
        uint256 charityId,
        string calldata title,
        string calldata description,
        string calldata category,
        uint256 target,
        string calldata evidenceUri
    ) external validCharity(charityId) returns (uint256 campaignId) {
        Charity storage charity = charities[charityId];
        if (charity.organizer != msg.sender) revert NotOrganizer();
        if (!charity.active || target == 0 || bytes(title).length == 0) revert InvalidAmount();
        campaignId = nextCampaignId++;
        campaigns[campaignId] = Campaign(campaignId, charityId, title, description, category, target, 0, 0, 0, 0, uint64(block.timestamp), CampaignStatus.Active, evidenceUri);
        campaignIds.push(campaignId);
        emit CampaignCreated(campaignId, charityId, title);
    }

    function setCampaignStatus(uint256 campaignId, CampaignStatus status) external validCampaign(campaignId) {
        Campaign storage campaign = campaigns[campaignId];
        if (charities[campaign.charityId].organizer != msg.sender && msg.sender != administrator) revert Unauthorized();
        if (campaign.status == CampaignStatus.Closed) revert InvalidStatus();
        campaign.status = status;
        emit CampaignStatusChanged(campaignId, status);
    }

    function donate(uint256 campaignId) external payable validCampaign(campaignId) {
        Campaign storage campaign = campaigns[campaignId];
        if (campaign.status != CampaignStatus.Active) revert InactiveCampaign();
        if (msg.value == 0) revert InvalidAmount();
        campaign.totalRaised += msg.value;
        campaign.donationCount += 1;
        campaignDonations[campaignId].push(Donation(msg.sender, msg.value, uint64(block.timestamp), block.number));
        emit DonationReceived(campaignId, msg.sender, msg.value);
    }

    function requestExpense(uint256 campaignId, uint256 amount, string calldata description, string calldata evidenceUri)
        external validCampaign(campaignId) returns (uint256 expenseId)
    {
        Campaign storage campaign = campaigns[campaignId];
        if (charities[campaign.charityId].organizer != msg.sender) revert NotOrganizer();
        if (amount == 0 || amount > availableFunds(campaignId)) revert InsufficientAvailableFunds();
        campaign.reservedPending += amount;
        expenseId = nextExpenseId++;
        expenseIndexById[expenseId] = campaignExpenses[campaignId].length;
        expenseCampaignById[expenseId] = campaignId;
        campaignExpenses[campaignId].push(ExpenseRequest(expenseId, campaignId, amount, description, evidenceUri, uint64(block.timestamp), ExpenseStatus.Pending, false));
        emit ExpenseRequested(expenseId, campaignId, amount);
    }

    function approveExpense(uint256 expenseId) external onlyAdmin {
        (ExpenseRequest storage expense, Campaign storage campaign) = _expense(expenseId);
        if (expense.status != ExpenseStatus.Pending) revert InvalidStatus();
        campaign.reservedPending -= expense.amount;
        campaign.totalReleased += expense.amount;
        expense.status = ExpenseStatus.Approved;
        expense.released = true;
        address recipient = charities[campaign.charityId].organizer;
        emit ExpenseApproved(expenseId, expense.campaignId, expense.amount);
        (bool success, ) = payable(recipient).call{value: expense.amount}("");
        if (!success) revert TransferFailed();
        emit FundsReleased(expenseId, expense.campaignId, recipient, expense.amount);
    }

    function rejectExpense(uint256 expenseId) external onlyAdmin {
        (ExpenseRequest storage expense, Campaign storage campaign) = _expense(expenseId);
        if (expense.status != ExpenseStatus.Pending) revert InvalidStatus();
        campaign.reservedPending -= expense.amount;
        expense.status = ExpenseStatus.Rejected;
        emit ExpenseRejected(expenseId, expense.campaignId);
    }

    function availableFunds(uint256 campaignId) public view validCampaign(campaignId) returns (uint256) {
        Campaign storage campaign = campaigns[campaignId];
        return campaign.totalRaised - campaign.totalReleased - campaign.reservedPending;
    }

    function getCharityIds() external view returns (uint256[] memory) { return charityIds; }
    function getCampaignIds() external view returns (uint256[] memory) { return campaignIds; }
    function getDonations(uint256 campaignId) external view validCampaign(campaignId) returns (Donation[] memory) { return campaignDonations[campaignId]; }
    function getExpenses(uint256 campaignId) external view validCampaign(campaignId) returns (ExpenseRequest[] memory) { return campaignExpenses[campaignId]; }
    function getExpense(uint256 expenseId) external view returns (ExpenseRequest memory) {
        (ExpenseRequest storage expense, ) = _expense(expenseId);
        return expense;
    }

    function _expense(uint256 expenseId) internal view returns (ExpenseRequest storage expense, Campaign storage campaign) {
        if (expenseId == 0 || expenseId >= nextExpenseId) revert InvalidId();
        uint256 campaignId = expenseCampaignById[expenseId];
        expense = campaignExpenses[campaignId][expenseIndexById[expenseId]];
        campaign = campaigns[campaignId];
    }
}
